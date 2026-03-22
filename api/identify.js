function parseMultipart(buffer, boundary) {
  const boundaryText = "--" + boundary;
  const parts = buffer.toString("binary").split(boundaryText);

  const result = {
    fields: {},
    files: {}
  };

  for (let part of parts) {
    if (!part || part === "--\r\n" || part === "--") continue;

    const index = part.indexOf("\r\n\r\n");
    if (index === -1) continue;

    const rawHeaders = part.slice(0, index);
    let rawBody = part.slice(index + 4);

    rawBody = rawBody.replace(/\r\n--$/, "");
    rawBody = rawBody.replace(/\r\n$/, "");

    const dispositionMatch = rawHeaders.match(/name="([^"]+)"/);
    if (!dispositionMatch) continue;

    const fieldName = dispositionMatch[1];
    const filenameMatch = rawHeaders.match(/filename="([^"]*)"/);
    const contentTypeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n]+)/i);

    if (filenameMatch) {
      result.files[fieldName] = {
        filename: filenameMatch[1],
        contentType: contentTypeMatch ? contentTypeMatch[1].trim() : "application/octet-stream",
        buffer: Buffer.from(rawBody, "binary")
      };
    } else {
      result.fields[fieldName] = rawBody;
    }
  }

  return result;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.PLANTNET_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "PLANTNET_API_KEY bulunamadı."
      });
    }

    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({
        error: "Beklenen veri tipi multipart/form-data"
      });
    }

    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      return res.status(400).json({
        error: "Multipart boundary bulunamadı."
      });
    }

    const boundary = boundaryMatch[1];

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const parsed = parseMultipart(buffer, boundary);

    const image = parsed.files.image;
    const localName = parsed.fields.localName || "";
    const localTurkish = parsed.fields.localTurkish || "";
    const localCategory = parsed.fields.localCategory || "";
    const localScore = Number(parsed.fields.localScore || 0);

    if (localScore >= 0.85) {
      return res.status(200).json({
        source: "local",
        data: {
          name: localName,
          turkish: localTurkish,
          category: localCategory,
          score: localScore
        }
      });
    }

    if (!image || !image.buffer || image.buffer.length === 0) {
      return res.status(400).json({
        error: "Görsel alınamadı."
      });
    }

    const mimeType = image.contentType || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/jpg"].includes(mimeType)) {
      return res.status(400).json({
        error: "Sadece JPG veya PNG desteklenir."
      });
    }

    const plantForm = new FormData();
    plantForm.append(
      "images",
      new Blob([image.buffer], { type: mimeType }),
      image.filename || "plant.jpg"
    );
    plantForm.append("organs", "leaf");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);

    const url =
      `https://my-api.plantnet.org/v2/identify/all` +
      `?api-key=${encodeURIComponent(apiKey)}` +
      `&nb-results=3` +
      `&lang=tr`;

    const response = await fetch(url, {
      method: "POST",
      body: plantForm,
      signal: controller.signal
    });

    clearTimeout(timeout);

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: result?.message || "PlantNet hata verdi",
        details: result
      });
    }

    if (!result.results || result.results.length === 0) {
      return res.status(200).json({
        source: "none",
        message: "Bitki bulunamadı."
      });
    }

    const best = result.results[0];

    return res.status(200).json({
      source: "plantnet",
      data: {
        name:
          best?.species?.scientificNameWithoutAuthor ||
          result.bestMatch ||
          "Bilinmiyor",
        family:
          best?.species?.family?.scientificName ||
          "Bilinmiyor",
        commonNames: best?.species?.commonNames || [],
        score: best?.score || 0
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return res.status(504).json({
        error: "PlantNet isteği zaman aşımına uğradı."
      });
    }

    return res.status(500).json({
      error: error.message || "Sunucu hatası."
    });
  }
};