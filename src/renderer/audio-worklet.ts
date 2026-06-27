// 在音频线程采集 PCM，攒到 2048 样本(128ms@16kHz)再发给主线程，降低消息频率
class CaptureProcessor extends AudioWorkletProcessor {
  private readonly buffer = new Float32Array(2048);
  private offset = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      return true;
    }
    let read = 0;
    while (read < channel.length) {
      const n = Math.min(channel.length - read, this.buffer.length - this.offset);
      this.buffer.set(channel.subarray(read, read + n), this.offset);
      this.offset += n;
      read += n;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer.slice());
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
