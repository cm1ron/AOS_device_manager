const H264Player = {
  active: false,
  decoder: null,
  canvas: null,
  ctx: null,
  canvasW: 0,
  canvasH: 0,
  pendingSPS: null,
  pendingPPS: null,
  configured: false,
  buffer: new Uint8Array(0),
  frameCount: 0,
  onFrame: null,
  onResize: null,

  isSupported() {
    return typeof window.VideoDecoder === 'function';
  },

  async start(canvas, serial, opts = {}) {
    if (!this.isSupported()) throw new Error('WebCodecs VideoDecoder not supported');
    this.stop();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.active = true;
    this.buffer = new Uint8Array(0);
    this.pendingSPS = null;
    this.pendingPPS = null;
    this.configured = false;
    this.frameCount = 0;

    this._onChunk = (chunk) => this._feed(chunk);
    this._onEnd = () => { this.configured = false; this.pendingSPS = null; this.pendingPPS = null; };
    window.api.onH264Chunk(this._onChunk);
    window.api.onH264End(this._onEnd);

    const result = await window.api.startH264Stream(serial, opts);
    if (!result || !result.success) {
      this.stop();
      throw new Error((result && result.error) || 'start stream failed');
    }
    return result;
  },

  async stop() {
    this.active = false;
    try { window.api.offH264Chunk(); } catch {}
    try { window.api.offH264End(); } catch {}
    try { await window.api.stopH264Stream(); } catch {}
    if (this.decoder) {
      try { this.decoder.close(); } catch {}
      this.decoder = null;
    }
    this.buffer = new Uint8Array(0);
    this.pendingSPS = null;
    this.pendingPPS = null;
    this.configured = false;
  },

  _feed(chunk) {
    if (!this.active) return;
    const incoming = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const merged = new Uint8Array(this.buffer.length + incoming.length);
    merged.set(this.buffer, 0);
    merged.set(incoming, this.buffer.length);
    this.buffer = merged;
    this._drainNals();
  },

  _findNalStart(buf, from) {
    for (let i = from; i < buf.length - 3; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0) {
        if (buf[i + 2] === 1) return { idx: i, prefix: 3 };
        if (buf[i + 2] === 0 && buf[i + 3] === 1) return { idx: i, prefix: 4 };
      }
    }
    return null;
  },

  _drainNals() {
    const buf = this.buffer;
    const first = this._findNalStart(buf, 0);
    if (!first) {
      if (buf.length > 1024 * 1024) this.buffer = buf.slice(-4);
      return;
    }
    let nalStart = first.idx;
    let prefixLen = first.prefix;
    let pos = first.idx + first.prefix;
    while (true) {
      const next = this._findNalStart(buf, pos);
      if (!next) {
        this.buffer = buf.slice(nalStart);
        return;
      }
      const nalPayload = buf.slice(nalStart + prefixLen, next.idx);
      this._handleNal(nalPayload, buf.slice(nalStart, next.idx));
      nalStart = next.idx;
      prefixLen = next.prefix;
      pos = next.idx + next.prefix;
    }
  },

  _handleNal(payload, nalWithStartCode) {
    if (!payload.length) return;
    const type = payload[0] & 0x1f;
    if (type === 7) {
      this.pendingSPS = nalWithStartCode;
      this._tryConfigure();
    } else if (type === 8) {
      this.pendingPPS = nalWithStartCode;
      this._tryConfigure();
    } else if (type === 5 || type === 1) {
      if (!this.configured) return;
      const isKey = type === 5;
      let data = nalWithStartCode;
      if (isKey && this.pendingSPS && this.pendingPPS) {
        const total = this.pendingSPS.length + this.pendingPPS.length + nalWithStartCode.length;
        const merged = new Uint8Array(total);
        let off = 0;
        merged.set(this.pendingSPS, off); off += this.pendingSPS.length;
        merged.set(this.pendingPPS, off); off += this.pendingPPS.length;
        merged.set(nalWithStartCode, off);
        data = merged;
      }
      try {
        this.decoder.decode(new EncodedVideoChunk({
          type: isKey ? 'key' : 'delta',
          timestamp: (this.frameCount++) * 33333,
          data,
        }));
      } catch (e) {
        console.warn('decode error', e);
      }
    }
  },

  _parseSpsSize(sps) {
    const stripped = this._stripStartCode(sps);
    if (stripped.length < 5) return null;
    const profileIdc = stripped[1];
    const rbsp = this._ebspToRbsp(stripped.slice(4));
    const br = new BitReader(rbsp);
    br.readUE();
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profileIdc)) {
      const chromaFormatIdc = br.readUE();
      if (chromaFormatIdc === 3) br.readBit();
      br.readUE();
      br.readUE();
      br.readBit();
      if (br.readBit()) {
        const lists = chromaFormatIdc !== 3 ? 8 : 12;
        for (let i = 0; i < lists; i++) {
          if (br.readBit()) {
            const size = i < 6 ? 16 : 64;
            let lastScale = 8, nextScale = 8;
            for (let j = 0; j < size; j++) {
              if (nextScale !== 0) {
                const deltaScale = br.readSE();
                nextScale = (lastScale + deltaScale + 256) % 256;
              }
              lastScale = nextScale === 0 ? lastScale : nextScale;
            }
          }
        }
      }
    }
    br.readUE();
    const picOrderCntType = br.readUE();
    if (picOrderCntType === 0) br.readUE();
    else if (picOrderCntType === 1) {
      br.readBit(); br.readSE(); br.readSE();
      const n = br.readUE();
      for (let i = 0; i < n; i++) br.readSE();
    }
    br.readUE();
    br.readBit();
    const picWidthInMbs = br.readUE() + 1;
    const picHeightInMapUnits = br.readUE() + 1;
    const frameMbsOnly = br.readBit();
    if (!frameMbsOnly) br.readBit();
    br.readBit();
    const frameCropping = br.readBit();
    let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
    if (frameCropping) {
      cropLeft = br.readUE();
      cropRight = br.readUE();
      cropTop = br.readUE();
      cropBottom = br.readUE();
    }
    const width = picWidthInMbs * 16 - (cropLeft + cropRight) * 2;
    const height = (2 - frameMbsOnly) * picHeightInMapUnits * 16 - (cropTop + cropBottom) * 2;
    return { width, height };
  },

  _ebspToRbsp(ebsp) {
    const out = [];
    for (let i = 0; i < ebsp.length; i++) {
      if (i + 2 < ebsp.length && ebsp[i] === 0 && ebsp[i + 1] === 0 && ebsp[i + 2] === 3) {
        out.push(0, 0);
        i += 2;
      } else {
        out.push(ebsp[i]);
      }
    }
    return new Uint8Array(out);
  },

  _tryConfigure() {
    if (this.configured || !this.pendingSPS || !this.pendingPPS) return;
    try {
      const size = this._parseSpsSize(this.pendingSPS);
      if (!size || size.width < 16 || size.height < 16) return;
      this.canvasW = size.width;
      this.canvasH = size.height;
      if (this.onResize) this.onResize(size.width, size.height);

      const spsRaw = this._stripStartCode(this.pendingSPS);
      const profileIdc = spsRaw[1];
      const profileComp = spsRaw[2];
      const levelIdc = spsRaw[3];
      const codec = `avc1.${[profileIdc, profileComp, levelIdc].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

      this.decoder = new VideoDecoder({
        output: (frame) => this._renderFrame(frame),
        error: (e) => console.warn('VideoDecoder error', e),
      });
      this.decoder.configure({
        codec,
        codedWidth: size.width,
        codedHeight: size.height,
        optimizeForLatency: true,
      });
      this.configured = true;
    } catch (e) {
      console.warn('configure failed', e);
    }
  },

  _stripStartCode(nal) {
    if (nal[0] === 0 && nal[1] === 0 && nal[2] === 1) return nal.slice(3);
    if (nal[0] === 0 && nal[1] === 0 && nal[2] === 0 && nal[3] === 1) return nal.slice(4);
    return nal;
  },

  _buildAvcDescription(sps, pps) {
    const len = 7 + 2 + sps.length + 1 + 2 + pps.length;
    const out = new Uint8Array(len);
    let p = 0;
    out[p++] = 1;
    out[p++] = sps[1];
    out[p++] = sps[2];
    out[p++] = sps[3];
    out[p++] = 0xff;
    out[p++] = 0xe1;
    out[p++] = (sps.length >> 8) & 0xff;
    out[p++] = sps.length & 0xff;
    out.set(sps, p); p += sps.length;
    out[p++] = 1;
    out[p++] = (pps.length >> 8) & 0xff;
    out[p++] = pps.length & 0xff;
    out.set(pps, p); p += pps.length;
    return out;
  },

  _renderFrame(frame) {
    if (!this.active) { frame.close(); return; }
    try {
      if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
        this.canvas.width = frame.displayWidth;
        this.canvas.height = frame.displayHeight;
      }
      this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
      if (this.onFrame) this.onFrame(frame.displayWidth, frame.displayHeight);
    } catch (e) {}
    frame.close();
  },
};

class BitReader {
  constructor(buf) {
    this.buf = buf;
    this.bitPos = 0;
  }
  readBit() {
    const byte = this.buf[this.bitPos >> 3];
    const bit = (byte >> (7 - (this.bitPos & 7))) & 1;
    this.bitPos++;
    return bit;
  }
  readBits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.readBit();
    return v;
  }
  readUE() {
    let zeros = 0;
    while (this.bitPos < this.buf.length * 8 && this.readBit() === 0) zeros++;
    if (zeros === 0) return 0;
    return ((1 << zeros) - 1) + this.readBits(zeros);
  }
  readSE() {
    const v = this.readUE();
    return v & 1 ? (v + 1) >> 1 : -(v >> 1);
  }
}

window.H264Player = H264Player;
