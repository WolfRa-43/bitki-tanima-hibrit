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

    const localName = parsed.fields.localName || "";
    const localTurkish = parsed.fields.localTurkish || "";
    const localCategory = parsed.fields.localCategory || "";
    const localScore = Number(parsed.fields.localScore || 0);

    let localData = null;
    if (localName) {
      localData = {
        name: localName,
        turkish: localTurkish,
        category: localCategory,
        score: localScore
      };
    }

    const plantFiles = ["image1", "image2", "image3"]
      .map((key) => parsed.files[key])
      .filter(Boolean)
      .filter((file) => file.buffer && file.buffer.length > 0);

    if (plantFiles.length === 0) {
      return res.status(400).json({
        error: "Hiç görsel alınamadı."
      });
    }

    const plantForm = new FormData();

    for (const file of plantFiles) {
      const mimeType = file.contentType || "image/jpeg";

      if (!["image/jpeg", "image/png", "image/jpg"].includes(mimeType)) {
        continue;
      }

      plantForm.append(
        "images",
        new Blob([file.buffer], { type: mimeType }),
        file.filename || "plant.jpg"
      );
    }

    if (!plantForm.has("images")) {
      return res.status(400).json({
        error: "Desteklenmeyen görsel formatı."
      });
    }

    plantForm.append("organs", "auto");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

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

    const candidates = (result.results || []).slice(0, 3).map((item) => ({
      name:
        item?.species?.scientificNameWithoutAuthor ||
        item?.species?.scientificName ||
        "Bilinmiyor",
      family:
        item?.species?.family?.scientificName ||
        "Bilinmiyor",
      commonNames: item?.species?.commonNames || [],
      score: item?.score || 0
    }));

    return res.status(200).json({
      local: localData,
      plantnet: {
        bestMatch: candidates[0] || null,
        candidates
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