const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

function solveLinearSystem(matrix, vector) {
  const n = vector.length
  const a = matrix.map((row, i) => [...row, vector[i]])

  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }

    if (Math.abs(a[pivot][col]) < 1e-10) {
      throw new Error('Não foi possível calcular a homografia para estes pontos.')
    }

    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    const div = a[col][col]
    for (let j = col; j <= n; j += 1) a[col][j] /= div

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = a[row][col]
      if (Math.abs(factor) < 1e-12) continue
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j]
    }
  }

  return a.map((row) => row[n])
}

export function computeHomography(source, destination) {
  if (source.length !== 4 || destination.length !== 4) {
    throw new Error('A homografia precisa de exatamente 4 pares de pontos.')
  }

  const A = []
  const b = []

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = source[i]
    const { x: u, y: v } = destination[i]

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }

  const h = solveLinearSystem(A, b)
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ]
}

export function projectPoint(matrix, point) {
  const { x, y } = point
  const d = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2]
  if (Math.abs(d) < 1e-10) return { x: 0, y: 0 }
  return {
    x: (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / d,
    y: (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / d,
  }
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function largestComponentRows(mask) {
  const { width: w, height: h, data } = mask
  const total = w * h
  const labels = new Int32Array(total)
  const queue = new Int32Array(total)
  let label = 0
  let bestLabel = 0
  let bestCount = 0

  for (let start = 0; start < total; start += 1) {
    if (data[start] < 128 || labels[start]) continue
    label += 1
    let head = 0
    let tail = 0
    let count = 0
    queue[tail++] = start
    labels[start] = label

    while (head < tail) {
      const idx = queue[head++]
      count += 1
      const x = idx % w
      const y = (idx / w) | 0

      const push = (next) => {
        if (next < 0 || next >= total || labels[next] || data[next] < 128) return
        labels[next] = label
        queue[tail++] = next
      }

      if (x > 0) push(idx - 1)
      if (x + 1 < w) push(idx + 1)
      if (y > 0) push(idx - w)
      if (y + 1 < h) push(idx + w)
    }

    if (count > bestCount) {
      bestCount = count
      bestLabel = label
    }
  }

  if (!bestLabel || bestCount < Math.max(100, total * 0.002)) {
    throw new Error('A máscara do piso é pequena demais para estimar a perspectiva.')
  }

  const rowMin = new Int32Array(h)
  const rowMax = new Int32Array(h)
  rowMin.fill(w)
  rowMax.fill(-1)

  for (let y = 0; y < h; y += 1) {
    const offset = y * w
    for (let x = 0; x < w; x += 1) {
      if (labels[offset + x] !== bestLabel) continue
      if (x < rowMin[y]) rowMin[y] = x
      if (x > rowMax[y]) rowMax[y] = x
    }
  }

  return { rowMin, rowMax, count: bestCount }
}

function robustEdge(rowMin, rowMax, fromY, toY) {
  const left = []
  const right = []
  const ys = []
  const start = Math.max(0, Math.floor(fromY))
  const end = Math.min(rowMin.length - 1, Math.ceil(toY))

  for (let y = start; y <= end; y += 1) {
    if (rowMax[y] < rowMin[y]) continue
    left.push(rowMin[y])
    right.push(rowMax[y])
    ys.push(y)
  }

  return {
    left: median(left),
    right: median(right),
    y: median(ys),
  }
}

export function orderQuad(points) {
  if (!points || points.length !== 4) throw new Error('São necessários 4 pontos.')
  const sorted = [...points].sort((a, b) => a.y - b.y)
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x)
  const bottom = sorted.slice(2).sort((a, b) => a.x - b.x)
  return [top[0], top[1], bottom[1], bottom[0]]
}

export function buildPerspective(points, width, height, source = 'manual') {
  const ordered = orderQuad(points).map((p) => ({
    x: clamp(p.x, 0, width - 1),
    y: clamp(p.y, 0, height - 1),
  }))

  const unit = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]

  return {
    points: ordered,
    matrix: computeHomography(unit, ordered),
    source,
  }
}

export function estimateFloorPerspective(mask, targetWidth, targetHeight) {
  if (!mask?.data || !mask.width || !mask.height) {
    throw new Error('Máscara inválida para estimar a perspectiva.')
  }

  const { rowMin, rowMax } = largestComponentRows(mask)
  let minY = rowMin.length - 1
  let maxY = 0
  let maxWidth = 0

  for (let y = 0; y < rowMin.length; y += 1) {
    if (rowMax[y] < rowMin[y]) continue
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    maxWidth = Math.max(maxWidth, rowMax[y] - rowMin[y] + 1)
  }

  const span = Math.max(1, maxY - minY)
  let topY = minY
  let bottomY = maxY

  for (let y = minY; y <= maxY; y += 1) {
    const width = rowMax[y] >= rowMin[y] ? rowMax[y] - rowMin[y] + 1 : 0
    if (width >= maxWidth * 0.22) {
      topY = y
      break
    }
  }

  for (let y = maxY; y >= minY; y -= 1) {
    const width = rowMax[y] >= rowMin[y] ? rowMax[y] - rowMin[y] + 1 : 0
    if (width >= maxWidth * 0.45) {
      bottomY = y
      break
    }
  }

  const band = Math.max(2, Math.round(span * 0.045))
  const top = robustEdge(rowMin, rowMax, topY, topY + band)
  const bottom = robustEdge(rowMin, rowMax, bottomY - band, bottomY)
  const sx = targetWidth / mask.width
  const sy = targetHeight / mask.height

  const raw = [
    { x: top.left * sx, y: top.y * sy },
    { x: top.right * sx, y: top.y * sy },
    { x: bottom.right * sx, y: bottom.y * sy },
    { x: bottom.left * sx, y: bottom.y * sy },
  ]

  return buildPerspective(raw, targetWidth, targetHeight, 'auto')
}

export function homographyText(matrix) {
  return matrix.map((row) => row.map((value) => Number(value.toFixed(6))))
}
