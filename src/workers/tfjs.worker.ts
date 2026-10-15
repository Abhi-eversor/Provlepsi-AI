import * as Comlink from 'comlink';
import * as tf from '@tensorflow/tfjs';
// WebGPU and WebGL backends imported for tfjs
import '@tensorflow/tfjs-backend-webgpu';
import '@tensorflow/tfjs-backend-webgl';

let isInitialized = false;
let initPromise: Promise<boolean> | null = null;

function prepareTimeSeriesData(data: number[], timesteps: number = 10, maxRows: number = 300) {
  // Truncate
  const recentData = data.slice(-maxRows);
  
  // Min-max scale
  const min = Math.min(...recentData);
  const max = Math.max(...recentData);
  const range = (max - min) || 1;
  const scaledData = recentData.map(v => (v - min) / range);
  
  const X: number[][][] = [];
  const y: number[][] = [];
  
  for (let i = 0; i < scaledData.length - timesteps; i++) {
    const window = scaledData.slice(i, i + timesteps).map(v => [v]);
    X.push(window);
    y.push([scaledData[i + timesteps]]);
  }
  
  // 80/20 train/test split
  const splitIdx = Math.floor(X.length * 0.8);
  
  return {
    X_train: X.slice(0, splitIdx),
    y_train: y.slice(0, splitIdx),
    X_test: X.slice(splitIdx),
    y_test: y.slice(splitIdx),
    min,
    range,
    scaledData,
    timesteps
  };
}

async function evaluateAndForecast(
  model: tf.LayersModel | tf.Sequential,
  X_test: number[][][],
  y_test: number[][],
  scaledData: number[],
  min: number,
  range: number,
  timesteps: number
) {
  // 1. Evaluate on test set
  let rmse = 0;
  let mae = 0;
  
  if (X_test.length > 0) {
    const xs = tf.tensor3d(X_test);
    const preds = model.predict(xs) as tf.Tensor;
    const predsArray = await preds.array() as number[][];
    
    let sumSqErr = 0;
    let sumAbsErr = 0;
    
    for (let i = 0; i < predsArray.length; i++) {
      const predUnscaled = (predsArray[i][0] * range) + min;
      const trueUnscaled = (y_test[i][0] * range) + min;
      
      const err = trueUnscaled - predUnscaled;
      sumSqErr += err * err;
      sumAbsErr += Math.abs(err);
    }
    
    rmse = Math.sqrt(sumSqErr / predsArray.length);
    mae = sumAbsErr / predsArray.length;
    
    xs.dispose();
    preds.dispose();
  }
  
  // 2. Iterative forecast for 10 steps
  const forecast: number[] = [];
  const currentWindow = scaledData.slice(-timesteps).map(v => [v]);
  
  for (let i = 0; i < 10; i++) {
    const xs = tf.tensor3d([currentWindow]);
    const pred = model.predict(xs) as tf.Tensor;
    const predArray = await pred.array() as number[][];
    const scaledPred = predArray[0][0];
    
    forecast.push((scaledPred * range) + min);
    
    // Slide window
    currentWindow.push([scaledPred]);
    currentWindow.shift();
    
    xs.dispose();
    pred.dispose();
  }
  
  return { metrics: { rmse, mae }, forecast };
}


const tfjsAPI = {
  async init(progressCallback?: (msg: string) => void) {
    if (isInitialized) return true;
    
    if (!initPromise) {
      initPromise = (async () => {
        if (progressCallback) progressCallback("Initializing TensorFlow.js backend...");
        try {
          const success = await tf.setBackend('webgpu');
          if (success) {
            if (progressCallback) progressCallback("TensorFlow.js backend set to WebGPU.");
          }
        } catch (e) {
          console.warn("WebGPU not available, falling back to WebGL.", e);
          await tf.setBackend('webgl');
          if (progressCallback) progressCallback("TensorFlow.js backend set to WebGL.");
        }
        await tf.ready();
        isInitialized = true;
        return true;
      })();
    }
    
    try {
      await initPromise;
      return true;
    } catch (e) {
      initPromise = null;
      throw e;
    }
  },

  async trainLSTM(
    data: number[],
    epochs: number = 10,
    units: number = 50,
    progressCallback?: (epoch: number, logs: any) => void
  ) {
    await this.init();
    
    const { X_train, y_train, X_test, y_test, min, range, scaledData, timesteps } = prepareTimeSeriesData(data, 10, 300);
    
    const model = tf.sequential();
    model.add(tf.layers.lstm({
      units: units,
      inputShape: [timesteps, 1],
      returnSequences: false
    }));
    model.add(tf.layers.dense({ units: 1 }));
    
    model.compile({
      optimizer: 'adam',
      loss: 'meanSquaredError'
    });
    
    const xs = tf.tensor3d(X_train);
    const ys = tf.tensor2d(y_train);
    
    await model.fit(xs, ys, {
      epochs: epochs,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if (progressCallback) {
            progressCallback(epoch, logs);
          }
        }
      }
    });
    
    const { metrics, forecast } = await evaluateAndForecast(model, X_test, y_test, scaledData, min, range, timesteps);

    // Save model to indexedDB
    const modelName = 'lstm-model-' + Date.now();
    await model.save('indexeddb://' + modelName);
    
    // Cleanup tensors
    xs.dispose();
    ys.dispose();
    
    return {
      modelName: modelName,
      metrics,
      forecast
    };
  },
  
  async predictLSTM(modelName: string, X_test: number[][][]) {
    await this.init();
    const model = await tf.loadLayersModel('indexeddb://' + modelName);
    const xs = tf.tensor3d(X_test);
    const preds = model.predict(xs) as tf.Tensor;
    const predictions = await preds.array();
    
    // Cleanup
    xs.dispose();
    preds.dispose();
    
    return predictions;
  },

async trainGRU(
  data: number[],
  epochs: number = 10,
  units: number = 50,
  progressCallback?: (epoch: number, logs: any) => void
) {
  await this.init();

  const { X_train, y_train, X_test, y_test, min, range, scaledData, timesteps } = prepareTimeSeriesData(data, 10, 300);

  const model = tf.sequential();
  model.add(tf.layers.gru({
    units: units,
    inputShape: [timesteps, 1],
    returnSequences: false
  }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

  const xs = tf.tensor3d(X_train);
  const ys = tf.tensor2d(y_train);

  await model.fit(xs, ys, {
    epochs: epochs,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if (progressCallback) progressCallback(epoch, logs);
      }
    }
  });

  const { metrics, forecast } = await evaluateAndForecast(model, X_test, y_test, scaledData, min, range, timesteps);

  const modelName = 'gru-model-' + Date.now();
  await model.save('indexeddb://' + modelName);

  xs.dispose();
  ys.dispose();

  return { modelName, metrics, forecast };
},

async predictGRU(modelName: string, X_test: number[][][]) {
  await this.init();
  const model = await tf.loadLayersModel('indexeddb://' + modelName);
  const xs = tf.tensor3d(X_test);
  const preds = model.predict(xs) as tf.Tensor;
  const predictions = await preds.array();
  xs.dispose();
  preds.dispose();
  return predictions;
},

async trainLSTMGRUHybrid(
  data: number[],
  epochs: number = 10,
  units: number = 50,
  progressCallback?: (epoch: number, logs: any) => void
) {
  await this.init();

  const { X_train, y_train, X_test, y_test, min, range, scaledData, timesteps } = prepareTimeSeriesData(data, 10, 300);

  const model = tf.sequential();
  // LSTM layer extracts long-range temporal patterns, passing a full sequence to GRU
  model.add(tf.layers.lstm({
    units: units,
    inputShape: [timesteps, 1],
    returnSequences: true
  }));
  // GRU layer compresses that sequence into a final representation
  model.add(tf.layers.gru({
    units: Math.max(8, Math.round(units / 2)),
    returnSequences: false
  }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

  const xs = tf.tensor3d(X_train);
  const ys = tf.tensor2d(y_train);

  await model.fit(xs, ys, {
    epochs: epochs,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if (progressCallback) progressCallback(epoch, logs);
      }
    }
  });

  const { metrics, forecast } = await evaluateAndForecast(model, X_test, y_test, scaledData, min, range, timesteps);

  const modelName = 'lstm-gru-hybrid-model-' + Date.now();
  await model.save('indexeddb://' + modelName);

  xs.dispose();
  ys.dispose();

  return { modelName, metrics, forecast };
},

async predictLSTMGRUHybrid(modelName: string, X_test: number[][][]) {
  await this.init();
  const model = await tf.loadLayersModel('indexeddb://' + modelName);
  const xs = tf.tensor3d(X_test);
  const preds = model.predict(xs) as tf.Tensor;
  const predictions = await preds.array();
  xs.dispose();
  preds.dispose();
  return predictions;
},

async trainBiLSTM(
  data: number[],
  epochs: number = 10,
  units: number = 50,
  progressCallback?: (epoch: number, logs: any) => void
) {
  await this.init();

  const { X_train, y_train, X_test, y_test, min, range, scaledData, timesteps } = prepareTimeSeriesData(data, 10, 300);

  const model = tf.sequential();

  model.add(tf.layers.bidirectional({
    layer: tf.layers.lstm({ units: units, returnSequences: false }) as any,
    inputShape: [timesteps, 1],
    mergeMode: 'concat'
  }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

  const xs = tf.tensor3d(X_train);
  const ys = tf.tensor2d(y_train);

  await model.fit(xs, ys, {
    epochs: epochs,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if (progressCallback) progressCallback(epoch, logs);
      }
    }
  });

  const { metrics, forecast } = await evaluateAndForecast(model, X_test, y_test, scaledData, min, range, timesteps);

  const modelName = 'bilstm-model-' + Date.now();
  await model.save('indexeddb://' + modelName);

  xs.dispose();
  ys.dispose();

  return { modelName, metrics, forecast };
},

async predictBiLSTM(modelName: string, X_test: number[][][]) {
  await this.init();
  const model = await tf.loadLayersModel('indexeddb://' + modelName);
  const xs = tf.tensor3d(X_test);
  const preds = model.predict(xs) as tf.Tensor;
  const predictions = await preds.array();
  xs.dispose();
  preds.dispose();
  return predictions;
},

async trainTransformer(
  data: number[],
  epochs: number = 10,
  headDim: number = 32,
  progressCallback?: (epoch: number, logs: any) => void
) {
  await this.init();

  const { X_train, y_train, X_test, y_test, min, range, scaledData, timesteps } = prepareTimeSeriesData(data, 10, 300);

  const features = 1;
  const ffDim = headDim * 2;

  const input = tf.input({ shape: [timesteps, features] });
  const query = tf.layers.dense({ units: headDim }).apply(input) as tf.SymbolicTensor;
  const key = tf.layers.dense({ units: headDim }).apply(input) as tf.SymbolicTensor;
  const value = tf.layers.dense({ units: headDim }).apply(input) as tf.SymbolicTensor;

  // Custom dot-product self-attention since tf.layers.attention is not available in tfjs
  const scores = tf.layers.dot({ axes: [2, 2] }).apply([query, key]) as tf.SymbolicTensor;
  const attnWeights = tf.layers.activation({ activation: 'softmax' }).apply(scores) as tf.SymbolicTensor;
  const attnOutput = tf.layers.dot({ axes: [2, 1] }).apply([attnWeights, value]) as tf.SymbolicTensor;
  
  const attnProjected = tf.layers.dense({ units: features }).apply(attnOutput) as tf.SymbolicTensor;

  const add1 = tf.layers.add().apply([input, attnProjected]) as tf.SymbolicTensor;
  const norm1 = tf.layers.layerNormalization().apply(add1) as tf.SymbolicTensor;

  const ff1 = tf.layers.dense({ units: ffDim, activation: 'relu' }).apply(norm1) as tf.SymbolicTensor;
  const ff2 = tf.layers.dense({ units: features }).apply(ff1) as tf.SymbolicTensor;
  const add2 = tf.layers.add().apply([norm1, ff2]) as tf.SymbolicTensor;
  const norm2 = tf.layers.layerNormalization().apply(add2) as tf.SymbolicTensor;

  const pooled = tf.layers.globalAveragePooling1d().apply(norm2) as tf.SymbolicTensor;
  const output = tf.layers.dense({ units: 1 }).apply(pooled) as tf.SymbolicTensor;

  const model = tf.model({ inputs: input, outputs: output });
  model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

  const xs = tf.tensor3d(X_train);
  const ys = tf.tensor2d(y_train);

  await model.fit(xs, ys, {
    epochs: epochs,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if (progressCallback) progressCallback(epoch, logs);
      }
    }
  });

  const { metrics, forecast } = await evaluateAndForecast(model, X_test, y_test, scaledData, min, range, timesteps);

  const modelName = 'transformer-model-' + Date.now();
  await model.save('indexeddb://' + modelName);

  xs.dispose();
  ys.dispose();

  return { modelName, metrics, forecast };
},

async predictTransformer(modelName: string, X_test: number[][][]) {
  await this.init();
  const model = await tf.loadLayersModel('indexeddb://' + modelName);
  const xs = tf.tensor3d(X_test);
  const preds = model.predict(xs) as tf.Tensor;
  const predictions = await preds.array();
  xs.dispose();
  preds.dispose();
  return predictions;
}
};

export type TfjsAPI = typeof tfjsAPI;
Comlink.expose(tfjsAPI);
