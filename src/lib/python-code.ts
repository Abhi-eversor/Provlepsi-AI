// Export the exact browser Python for fixture verification as well as worker execution.
export const READ_CSV_PYTHON = `
import pandas as pd
import numpy as np
import io, csv, json

def read_dataset(content):
    content = content.lstrip('\\ufeff')
    csv.field_size_limit(5 * 1024 * 1024)
    records = csv.reader(io.StringIO(content), strict=True)
    header = next(records, [])
    if not header or any(not str(name).strip() for name in header):
        raise ValueError('CSV must have a nonempty header for every column.')
    if len(set(header)) != len(header):
        raise ValueError('CSV column names must be unique.')
    if len(header) > 100:
        raise ValueError('CSV exceeds the 100 column limit.')
    observations = 0
    for row in records:
        if not row:
            continue
        if len(row) != len(header):
            raise ValueError('CSV record ending on line %d has %d fields; expected %d. Correct the CSV before uploading.' % (records.line_num, len(row), len(header)))
        observations += 1
        if observations > 100000:
            raise ValueError('CSV exceeds the 100,000 observation limit.')
    df = pd.read_csv(io.StringIO(content), nrows=100001)
    if len(df) > 100000:
        raise ValueError('CSV exceeds the 100,000 observation limit. Select a smaller dataset.')
    if not len(df):
        raise ValueError('CSV contains no observations.')
    if len(df.columns) > 100:
        raise ValueError('CSV exceeds the 100 column limit.')
    return df
`;

export const PREVIEW_PYTHON = `
def preview_dataset():
    df = read_dataset(csv_content).replace([np.inf, -np.inf], np.nan)
    numeric = df.select_dtypes(include=['number'])
    return json.dumps({
        'columns': list(df.columns), 'shape': list(df.shape),
        'dtypes': {k: str(v) for k, v in df.dtypes.items()},
        'preview': json.loads(df.head(100).to_json(orient='records')),
        'correlation_matrix': json.loads(numeric.corr().to_json()) if not numeric.empty else {},
        'summary_statistics': json.loads(numeric.describe().to_json()) if not numeric.empty else {}
    }, allow_nan=False)
preview_dataset()
`;

export const PARSE_DATASET_PYTHON = `
def parse_dataset():
    df = read_dataset(csv_content)
    if target_col not in df.columns:
        raise ValueError('Target column was not found in the CSV.')
    original = df[target_col]
    target = pd.to_numeric(original, errors='coerce').replace([np.inf, -np.inf], np.nan)
    invalid = original.notna() & target.isna()
    if invalid.any():
        raise ValueError('Target contains nonnumeric or infinite values. Choose a numeric column or correct those observations.')
    numeric = df.select_dtypes(include=['number']).drop(columns=[target_col], errors='ignore').replace([np.inf, -np.inf], np.nan)
    return json.dumps({
        'indices': list(range(len(df))), 'target': json.loads(target.to_json(orient='values')),
        'features': json.loads(numeric.to_json(orient='values')) if len(numeric.columns) else [[] for _ in range(len(df))],
        'featureNames': list(numeric.columns), 'sourceRowCount': len(df), 'targetColumn': target_col
    }, allow_nan=False)
parse_dataset()
`;

export const TRAIN_MODEL_PYTHON = `
import json, warnings
import numpy as np

def forecast_partition(partition, steps, model_type, config):
    y = np.asarray(partition['target'], dtype=float)
    if np.isfinite(y).sum() < config['lookback'] + 2:
        raise ValueError('Not enough usable training observations after preprocessing.')
    if model_type == 'arima':
        from statsmodels.tsa.arima.model import ARIMA
        fitted = ARIMA(y, order=(1, 1, 1)).fit(method_kwargs={'method': 'nm', 'maxiter': 100})
        return np.asarray(fitted.forecast(steps=steps), dtype=float).tolist(), bool(fitted.mle_retvals.get('converged', True))
    from sklearn.linear_model import LinearRegression
    from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor
    lookback = config['lookback']
    covariates = np.asarray(partition['features'], dtype=float)
    X, labels = [], []
    for i in range(lookback, len(y)):
        row = np.concatenate((y[i-lookback:i], covariates[i]))
        if np.isfinite(row).all() and np.isfinite(y[i]):
            X.append(row)
            labels.append(y[i])
    if len(X) < 2:
        raise ValueError('Not enough contiguous usable lag windows. Reduce lookback or change the missing-value/outlier strategy.')
    if not np.isfinite(y[-lookback:]).all() or not np.isfinite(covariates[-1]).all():
        raise ValueError('Dropped observations leave gaps in the final forecast context. Use filling/clipping or provide complete recent observations.')
    if model_type == 'linear':
        model = LinearRegression()
    elif model_type == 'randomForest':
        model = RandomForestRegressor(n_estimators=config['rfEstimators'], max_depth=config['rfMaxDepth'] or None,
            min_samples_split=config['rfMinSamplesSplit'], random_state=config['seed'], n_jobs=1)
    elif model_type == 'boosting':
        model = HistGradientBoostingRegressor(random_state=config['seed'], max_iter=100, min_samples_leaf=2)
    else:
        raise ValueError('Unknown Python model.')
    model.fit(np.asarray(X), np.asarray(labels))
    context, last_features, predictions = y[-lookback:].tolist(), covariates[-1], []
    for _ in range(steps):
        row = np.concatenate((np.asarray(context), last_features)).reshape(1, -1)
        value = float(model.predict(row)[0])
        if not np.isfinite(value):
            raise ValueError('Model produced a nonfinite prediction. Rescale the input or choose a different model.')
        predictions.append(value)
        context = context[1:] + [value]
    return predictions, True

def train_and_forecast():
    run = json.loads(run_json)
    messages = []
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter('always')
        evaluation, converged_train = forecast_partition(run['train'], len(run['validation']['actual']), model_type, run['config'])
        future, converged_final = forecast_partition(run['final'], run['config']['horizon'], model_type, run['config'])
        messages.extend(str(item.message) for item in captured)
    if not converged_train or not converged_final:
        messages.append('ARIMA optimizer did not converge; interpret this result cautiously.')
    if run['featureNames'] and model_type != 'arima':
        messages.append('Future numeric covariates are held at their last observed training value during evaluation and at the last observed value during final forecasting.')
    if run['featureNames'] and model_type == 'arima':
        messages.append('ARIMA is univariate and ignores additional numeric feature columns.')
    return json.dumps({'evaluationPredictions': evaluation, 'forecast': future,
        'warnings': list(dict.fromkeys(messages)),
        'artifact': {'engine': 'Pyodide', 'pyodideVersion': '0.25.0', 'numpyVersion': np.__version__,
            'modelType': model_type, 'evaluationFit': 'training-only', 'finalFit': 'all-observed-history',
            'featureNames': run['featureNames'], 'config': run['config']}}, allow_nan=False)
train_and_forecast()
`;
