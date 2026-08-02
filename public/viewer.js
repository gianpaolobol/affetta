/* Affetta STL Viewer v0.5.1
 * Viewer WebGL interattivo con fallback Canvas 2D interattivo.
 * Il caricamento del file non viene mai bloccato dall'assenza di WebGL.
 */

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
const length3 = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize3 = (a) => {
  const length = length3(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const faceNormal = (a, b, c) => normalize3(cross3(sub3(b, a), sub3(c, a)));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function finiteVertex(vertex) {
  return vertex.every((value) => Number.isFinite(value) && Math.abs(value) < 1e9);
}

function normalizePrinterBed(input, fallbackBuild = [220, 220, 250]) {
  if (Array.isArray(input)) {
    return {
      build: input.length >= 3 ? input.map(Number) : fallbackBuild,
      bedShape: 'rectangular',
      buildDiameter: null
    };
  }
  const build = Array.isArray(input?.build_mm) && input.build_mm.length >= 3
    ? input.build_mm.map(Number)
    : fallbackBuild;
  const bedShape = input?.bed_shape === 'circular' ? 'circular' : 'rectangular';
  const buildDiameter = bedShape === 'circular'
    ? Number(input?.build_diameter_mm || Math.min(build[0], build[1]))
    : null;
  return { build, bedShape, buildDiameter };
}

export function buildPlateSegments(input) {
  const { build, bedShape, buildDiameter } = normalizePrinterBed(input);
  const [width, depth] = build;
  const step = Math.max(width, depth) > 400 ? 20 : 10;
  const segments = [];

  if (bedShape === 'circular') {
    const radius = buildDiameter / 2;
    for (let x = -radius; x <= radius + 0.01; x += step) {
      const span = Math.sqrt(Math.max(0, radius * radius - x * x));
      segments.push([[x, -span, 0], [x, span, 0]]);
    }
    for (let y = -radius; y <= radius + 0.01; y += step) {
      const span = Math.sqrt(Math.max(0, radius * radius - y * y));
      segments.push([[-span, y, 0], [span, y, 0]]);
    }
    const perimeterSteps = Math.max(72, Math.ceil(buildDiameter / 4));
    for (let index = 0; index < perimeterSteps; index += 1) {
      const a = index / perimeterSteps * Math.PI * 2;
      const b = (index + 1) / perimeterSteps * Math.PI * 2;
      segments.push([
        [Math.cos(a) * radius, Math.sin(a) * radius, 0],
        [Math.cos(b) * radius, Math.sin(b) * radius, 0]
      ]);
    }
    return segments;
  }

  for (let x = -width / 2; x <= width / 2 + 0.01; x += step) {
    segments.push([[x, -depth / 2, 0], [x, depth / 2, 0]]);
  }
  for (let y = -depth / 2; y <= depth / 2 + 0.01; y += step) {
    segments.push([[-width / 2, y, 0], [width / 2, y, 0]]);
  }
  segments.push(
    [[-width / 2, -depth / 2, 0], [width / 2, -depth / 2, 0]],
    [[width / 2, -depth / 2, 0], [width / 2, depth / 2, 0]],
    [[width / 2, depth / 2, 0], [-width / 2, depth / 2, 0]],
    [[-width / 2, depth / 2, 0], [-width / 2, -depth / 2, 0]]
  );
  return segments;
}

export function parseStl(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 15) {
    throw new Error('Il file STL è vuoto o non valido.');
  }

  const bytes = new Uint8Array(buffer);
  const header = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 512))).trimStart();
  const looksAscii = /^solid(?:\s|$)/i.test(header) && /facet\s+normal|vertex\s+/i.test(header);
  const view = new DataView(buffer);
  let binaryCount = 0;
  let binarySize = 0;

  if (buffer.byteLength >= 84) {
    binaryCount = view.getUint32(80, true);
    binarySize = 84 + binaryCount * 50;
  }

  // Alcuni STL binari iniziano con la parola "solid". La lunghezza strutturale
  // resta quindi il controllo principale, mentre l'header aiuta per gli ASCII.
  const isBinary = binaryCount > 0
    && binaryCount <= 10_000_000
    && binarySize <= buffer.byteLength
    && (!looksAscii || binarySize === buffer.byteLength);

  const vertices = [];
  const normals = [];

  if (isBinary) {
    for (let triangleIndex = 0; triangleIndex < binaryCount; triangleIndex += 1) {
      const offset = 84 + triangleIndex * 50;
      const declaredNormal = [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true)
      ];
      const triangle = [];
      for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
        const vertexOffset = offset + 12 + vertexIndex * 12;
        const vertex = [
          view.getFloat32(vertexOffset, true),
          view.getFloat32(vertexOffset + 4, true),
          view.getFloat32(vertexOffset + 8, true)
        ];
        if (!finiteVertex(vertex)) throw new Error('Lo STL contiene coordinate non valide.');
        triangle.push(vertex);
      }
      const normal = finiteVertex(declaredNormal) && length3(declaredNormal) > 1e-8
        ? normalize3(declaredNormal)
        : faceNormal(triangle[0], triangle[1], triangle[2]);
      for (const vertex of triangle) {
        vertices.push(...vertex);
        normals.push(...normal);
      }
    }
  } else {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const rawVertices = [];
    const expression = /vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/gi;
    for (const match of text.matchAll(expression)) {
      const vertex = [Number(match[1]), Number(match[2]), Number(match[3])];
      if (!finiteVertex(vertex)) throw new Error('Lo STL contiene coordinate non valide.');
      rawVertices.push(vertex);
    }
    if (rawVertices.length < 3 || rawVertices.length % 3 !== 0) {
      throw new Error('STL ASCII non leggibile o incompleto.');
    }
    for (let index = 0; index < rawVertices.length; index += 3) {
      const normal = faceNormal(rawVertices[index], rawVertices[index + 1], rawVertices[index + 2]);
      for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
        vertices.push(...rawVertices[index + vertexIndex]);
        normals.push(...normal);
      }
    }
  }

  if (!vertices.length) throw new Error('Lo STL non contiene triangoli.');
  return {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(normals),
    triangleCount: vertices.length / 9
  };
}

function centerGeometry(parsed) {
  const positions = parsed.vertices;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }

  const size = max.map((value, axis) => value - min[axis]);
  const centerX = (min[0] + max[0]) / 2;
  const centerY = (min[1] + max[1]) / 2;
  const floorZ = min[2];

  for (let index = 0; index < positions.length; index += 3) {
    positions[index] -= centerX;
    positions[index + 1] -= centerY;
    positions[index + 2] -= floorZ;
  }

  return { min, max, size };
}

function colorRgb(hex) {
  const cleaned = String(hex || '#e7472f').replace('#', '');
  const normalized = cleaned.length === 3
    ? cleaned.split('').map((character) => character + character).join('')
    : cleaned.padEnd(6, '0').slice(0, 6);
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255
  ];
}

function perspective(fov, aspect, near, far) {
  const factor = 1 / Math.tan(fov / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    factor / aspect, 0, 0, 0,
    0, factor, 0, 0,
    0, 0, (far + near) * range, -1,
    0, 0, 2 * far * near * range, 0
  ]);
}

function lookAt(eye, target, up) {
  const z = normalize3(sub3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ]);
}

function multiply(a, b) {
  const output = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      output[column * 4 + row] =
        a[row] * b[column * 4]
        + a[4 + row] * b[column * 4 + 1]
        + a[8 + row] * b[column * 4 + 2]
        + a[12 + row] * b[column * 4 + 3];
    }
  }
  return output;
}

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Errore shader WebGL.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Errore collegamento WebGL.';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

class WebGLViewer {
  constructor(container, status) {
    this.container = container;
    this.status = status;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewer-canvas';
    container.replaceChildren(this.canvas);
    this.gl = this.canvas.getContext('webgl', {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false
    });
    if (!this.gl) throw new Error('WebGL non disponibile.');

    this.build = [220, 220, 250];
    this.bedShape = 'rectangular';
    this.buildDiameter = null;
    this.color = '#e7472f';
    this.mesh = null;
    this.bounds = null;
    this.yaw = 0.78;
    this.pitch = 0.58;
    this.distance = 420;
    this.target = [0, 0, 0];
    this.wireframe = false;
    this.drag = null;

    this.initGl();
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    status.textContent = 'Viewer 3D · trascina per ruotare · rotella per zoom';
  }

  initGl() {
    const gl = this.gl;
    this.meshProgram = createProgram(gl,
      'attribute vec3 position; attribute vec3 normal; uniform mat4 mvp; varying vec3 vNormal; void main(){ gl_Position=mvp*vec4(position,1.0); vNormal=normal; }',
      'precision mediump float; varying vec3 vNormal; uniform vec3 objectColor; void main(){ vec3 n=normalize(vNormal); float light=max(dot(n,normalize(vec3(0.35,-0.45,0.82))),0.0); gl_FragColor=vec4(objectColor*(0.48+0.58*light),1.0); }'
    );
    this.lineProgram = createProgram(gl,
      'attribute vec3 position; uniform mat4 mvp; void main(){ gl_Position=mvp*vec4(position,1.0); }',
      'precision mediump float; uniform vec3 lineColor; void main(){ gl_FragColor=vec4(lineColor,1.0); }'
    );
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.055, 0.063, 0.075, 1);
    this.gridBuffer = gl.createBuffer();
    this.rebuildGrid();
  }

  rebuildGrid() {
    const gl = this.gl;
    const segments = buildPlateSegments({
      build_mm: this.build,
      bed_shape: this.bedShape,
      build_diameter_mm: this.buildDiameter
    });
    const vertices = segments.flat(2);
    this.gridCount = vertices.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (event) => {
      this.canvas.setPointerCapture?.(event.pointerId);
      this.drag = { x: event.clientX, y: event.clientY };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      this.yaw += (event.clientX - this.drag.x) * 0.008;
      this.pitch = Math.max(0.08, Math.min(1.48, this.pitch + (event.clientY - this.drag.y) * 0.008));
      this.drag = { x: event.clientX, y: event.clientY };
      this.draw();
    });
    const stopDrag = () => { this.drag = null; };
    this.canvas.addEventListener('pointerup', stopDrag);
    this.canvas.addEventListener('pointercancel', stopDrag);
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.distance = Math.max(20, Math.min(5000, this.distance * Math.exp(event.deltaY * 0.001)));
      this.draw();
    }, { passive: false });
    this.canvas.addEventListener('dblclick', () => this.reset());
  }

  resize() {
    const rectangle = this.container.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(2, Math.round(rectangle.width * pixelRatio));
    const height = Math.max(2, Math.round(rectangle.height * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.width = `${rectangle.width}px`;
      this.canvas.style.height = `${rectangle.height}px`;
      this.gl.viewport(0, 0, width, height);
    }
    this.draw();
  }

  setPrinter(printer) {
    const geometry = normalizePrinterBed(printer, this.build);
    this.build = geometry.build;
    this.bedShape = geometry.bedShape;
    this.buildDiameter = geometry.buildDiameter;
    this.rebuildGrid();
    if (!this.mesh) this.distance = Math.max(this.build[0], this.build[1]) * 1.55;
    this.draw();
  }

  load(buffer) {
    const parsed = parseStl(buffer);
    const bounds = centerGeometry(parsed);
    const gl = this.gl;

    if (this.mesh) {
      gl.deleteBuffer(this.mesh.positionBuffer);
      gl.deleteBuffer(this.mesh.normalBuffer);
    }

    this.mesh = {
      count: parsed.vertices.length / 3,
      positionBuffer: gl.createBuffer(),
      normalBuffer: gl.createBuffer()
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, parsed.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, parsed.normals, gl.STATIC_DRAW);
    this.bounds = bounds;
    this.reset();
    return { size: bounds.size, triangleCount: parsed.triangleCount, renderer: 'webgl' };
  }

  setColor(color) {
    this.color = color || this.color;
    this.draw();
  }

  toggleWireframe() {
    this.wireframe = !this.wireframe;
    this.draw();
  }

  reset() {
    const maximum = this.bounds ? Math.max(...this.bounds.size, 20) : Math.max(this.build[0], this.build[1]);
    this.yaw = 0.78;
    this.pitch = 0.58;
    this.distance = maximum * 2.8;
    this.draw();
  }

  matrix() {
    const aspect = this.canvas.width / this.canvas.height;
    const eye = [
      this.distance * Math.cos(this.pitch) * Math.cos(this.yaw),
      this.distance * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.distance * Math.sin(this.pitch)
    ];
    return multiply(
      perspective(Math.PI / 4, aspect, 0.1, 10000),
      lookAt(eye, this.target, [0, 0, 1])
    );
  }

  draw() {
    const gl = this.gl;
    if (!this.canvas.width) return;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const mvp = this.matrix();

    gl.useProgram(this.lineProgram);
    let location = gl.getAttribLocation(this.lineProgram, 'position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'mvp'), false, mvp);
    gl.uniform3f(gl.getUniformLocation(this.lineProgram, 'lineColor'), 0.23, 0.27, 0.32);
    gl.drawArrays(gl.LINES, 0, this.gridCount);

    if (!this.mesh) return;
    gl.useProgram(this.meshProgram);
    location = gl.getAttribLocation(this.meshProgram, 'position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.positionBuffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
    const normalLocation = gl.getAttribLocation(this.meshProgram, 'normal');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.normalBuffer);
    gl.enableVertexAttribArray(normalLocation);
    gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.meshProgram, 'mvp'), false, mvp);
    gl.uniform3fv(gl.getUniformLocation(this.meshProgram, 'objectColor'), colorRgb(this.color));
    gl.drawArrays(gl.TRIANGLES, 0, this.mesh.count);

    if (this.wireframe) {
      gl.useProgram(this.lineProgram);
      location = gl.getAttribLocation(this.lineProgram, 'position');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.positionBuffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'mvp'), false, mvp);
      gl.uniform3f(gl.getUniformLocation(this.lineProgram, 'lineColor'), 1, 0.78, 0.68);
      // Ogni triangolo viene disegnato come tre segmenti. Non è una mesh indicizzata,
      // ma fornisce un reticolo affidabile e leggero per l'anteprima.
      for (let offset = 0; offset < this.mesh.count; offset += 3) {
        gl.drawArrays(gl.LINE_LOOP, offset, 3);
      }
    }
  }
}

class CanvasFallbackViewer {
  constructor(container, status, reason = '') {
    this.container = container;
    this.status = status;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewer-canvas';
    container.replaceChildren(this.canvas);
    this.context = this.canvas.getContext('2d');
    this.build = [220, 220, 250];
    this.bedShape = 'rectangular';
    this.buildDiameter = null;
    this.color = '#e7472f';
    this.parsed = null;
    this.bounds = null;
    this.yaw = -0.65;
    this.pitch = 0.52;
    this.zoom = 1;
    this.drag = null;
    this.wireframe = false;
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.status.textContent = `Viewer compatibile attivo${reason ? ` · ${reason}` : ''}`;
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (event) => {
      this.drag = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture?.(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      this.yaw += (event.clientX - this.drag.x) * 0.01;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + (event.clientY - this.drag.y) * 0.01));
      this.drag = { x: event.clientX, y: event.clientY };
      this.draw();
    });
    const stop = () => { this.drag = null; };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoom = Math.max(0.2, Math.min(8, this.zoom * Math.exp(-event.deltaY * 0.001)));
      this.draw();
    }, { passive: false });
    this.canvas.addEventListener('dblclick', () => this.reset());
  }

  resize() {
    const rectangle = this.container.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(2, Math.round(rectangle.width * pixelRatio));
    this.canvas.height = Math.max(2, Math.round(rectangle.height * pixelRatio));
    this.canvas.style.width = `${rectangle.width}px`;
    this.canvas.style.height = `${rectangle.height}px`;
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.draw();
  }

  setPrinter(printer) {
    const geometry = normalizePrinterBed(printer, this.build);
    this.build = geometry.build;
    this.bedShape = geometry.bedShape;
    this.buildDiameter = geometry.buildDiameter;
    this.draw();
  }

  load(buffer) {
    const parsed = parseStl(buffer);
    const bounds = centerGeometry(parsed);
    this.parsed = parsed;
    this.bounds = bounds;
    this.reset();
    return { size: bounds.size, triangleCount: parsed.triangleCount, renderer: 'canvas-fallback' };
  }

  setColor(color) {
    this.color = color || this.color;
    this.draw();
  }

  toggleWireframe() {
    this.wireframe = !this.wireframe;
    this.draw();
  }

  reset() {
    this.yaw = -0.65;
    this.pitch = 0.52;
    this.zoom = 1;
    this.draw();
  }

  project(vertex, scale, centerX, centerY) {
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const x1 = vertex[0] * cosY - vertex[1] * sinY;
    const y1 = vertex[0] * sinY + vertex[1] * cosY;
    const y2 = y1 * cosP - vertex[2] * sinP;
    const z2 = y1 * sinP + vertex[2] * cosP;
    return [centerX + x1 * scale, centerY - z2 * scale - y2 * scale * 0.08, y2];
  }

  draw() {
    const context = this.context;
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#15171a';
    context.fillRect(0, 0, width, height);

    const maximumBuild = this.bedShape === 'circular'
      ? Number(this.buildDiameter || Math.min(this.build[0], this.build[1]))
      : Math.max(this.build[0], this.build[1]);
    const baseScale = Math.min(width, height) * 0.58 / maximumBuild;
    const centerX = width / 2;
    const centerY = height * 0.7;

    context.save();
    context.strokeStyle = '#353b42';
    context.lineWidth = 1;
    const segments = buildPlateSegments({
      build_mm: this.build,
      bed_shape: this.bedShape,
      build_diameter_mm: this.buildDiameter
    });
    for (const [start, end] of segments) {
      const a = this.project(start, baseScale, centerX, centerY);
      const b = this.project(end, baseScale, centerX, centerY);
      context.beginPath(); context.moveTo(a[0], a[1]); context.lineTo(b[0], b[1]); context.stroke();
    }
    context.restore();

    if (!this.parsed || !this.bounds) return;
    const modelMaximum = Math.max(...this.bounds.size, 1);
    const modelScale = Math.min(width, height) * 0.48 / modelMaximum * this.zoom;
    const positions = this.parsed.vertices;
    const triangleCount = positions.length / 9;
    const stride = Math.max(1, Math.ceil(triangleCount / 25000));
    const triangles = [];

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += stride) {
      const offset = triangleIndex * 9;
      const points = [0, 1, 2].map((vertexIndex) => this.project([
        positions[offset + vertexIndex * 3],
        positions[offset + vertexIndex * 3 + 1],
        positions[offset + vertexIndex * 3 + 2]
      ], modelScale, centerX, height * 0.66));
      triangles.push({ points, depth: (points[0][2] + points[1][2] + points[2][2]) / 3 });
    }

    triangles.sort((a, b) => a.depth - b.depth);
    const [red, green, blue] = colorRgb(this.color).map((value) => Math.round(value * 255));
    for (const triangle of triangles) {
      context.beginPath();
      context.moveTo(triangle.points[0][0], triangle.points[0][1]);
      context.lineTo(triangle.points[1][0], triangle.points[1][1]);
      context.lineTo(triangle.points[2][0], triangle.points[2][1]);
      context.closePath();
      if (!this.wireframe) {
        context.fillStyle = `rgba(${red},${green},${blue},0.86)`;
        context.fill();
      }
      context.strokeStyle = this.wireframe ? '#ffd0c5' : 'rgba(20,20,20,0.18)';
      context.lineWidth = this.wireframe ? 0.8 : 0.35;
      context.stroke();
    }
  }
}

export function createViewer(container, status) {
  try {
    return new WebGLViewer(container, status);
  } catch (error) {
    console.warn('Affetta: WebGL non disponibile, uso viewer compatibile.', error);
    return new CanvasFallbackViewer(container, status, 'modalità compatibile');
  }
}
