let model;
let plantsData = [];
let datasetEmbeddings = [];
let selectedFile = null;

const imageInput = document.getElementById("imageInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const preview = document.getElementById("preview");
const result = document.getElementById("result");

imageInput.addEventListener("change", (event) => {
  selectedFile = event.target.files[0];

  if (selectedFile) {
    preview.src = URL.createObjectURL(selectedFile);
    preview.style.display = "block";
  }
});

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile) {
    result.textContent = "Lütfen foto seç.";
    return;
  }

  try {
    result.textContent = "1/4 Görsel okunuyor...";

    const uploadedImg = await loadImageFromFile(selectedFile);

    result.textContent = "2/4 Görsel embedding hazırlanıyor...";

    const uploadedEmbedding = await getEmbedding(uploadedImg);

    result.textContent = "3/4 Yerel veritabanı ile karşılaştırılıyor...";

    let bestMatch = null;
    let bestScore = -1;

    for (const item of datasetEmbeddings) {
      const score = cosineSimilarity(uploadedEmbedding, item.embedding);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    }

    if (!bestMatch) {
      result.textContent = "Hiç eşleşme bulunamadı.";
      return;
    }

    result.textContent = "4/4 İnternet destekli kontrol yapılıyor...";

    const formData = new FormData();
    formData.append("image", selectedFile);
    formData.append("localName", bestMatch.name || "");
    formData.append("localTurkish", bestMatch.turkish || "");
    formData.append("localCategory", bestMatch.category || "");
    formData.append("localScore", String(bestScore));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const apiResponse = await fetch("/api/identify", {
      method: "POST",
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeout);

    const apiData = await apiResponse.json();

    if (!apiResponse.ok) {
      result.textContent = `Sunucu hatası: ${apiData.error || "Bilinmeyen hata"}`;
      return;
    }

    if (apiData.source === "local") {
      result.textContent =
        `Bitki: ${apiData.data.name}\n` +
        `Türkçe: ${apiData.data.turkish}\n` +
        `Kategori: ${apiData.data.category}\n` +
        `Benzerlik: %${(apiData.data.score * 100).toFixed(2)}\n` +
        `Kaynak: Sistem veritabanı`;
      return;
    }

    if (apiData.source === "plantnet") {
      const commonNames =
        apiData.data.commonNames && apiData.data.commonNames.length
          ? apiData.data.commonNames.join(", ")
          : "Yok";

      result.textContent =
        `Bitki: ${apiData.data.name}\n` +
        `Aile: ${apiData.data.family}\n` +
        `Yaygın adlar: ${commonNames}\n` +
        `Güven: %${(apiData.data.score * 100).toFixed(2)}\n` +
        `Kaynak: PlantNet`;
      return;
    }

    if (apiData.source === "none") {
      result.textContent = "Bitki bulunamadı.";
      return;
    }

    result.textContent = "Sonuç alınamadı.";
  } catch (error) {
    if (error.name === "AbortError") {
      result.textContent = "İstek zaman aşımına uğradı. PlantNet cevabı geç kaldı.";
      return;
    }

    result.textContent = "Hata: " + error.message;
    console.error(error);
  }
});

async function init() {
  try {
    result.textContent = "Model yükleniyor...";

    model = await mobilenet.load();

    result.textContent = "Bitki verileri alınıyor...";

    const response = await fetch("/api/plants");
    const data = await response.json();
    plantsData = data.plants;

    result.textContent = "Referans görseller hazırlanıyor...";

    for (const plant of plantsData) {
      for (const imgName of plant.images) {
        const img = await loadImageFromUrl(`/images/${imgName}`);
        const embedding = await getEmbedding(img);

        datasetEmbeddings.push({
          name: plant.name,
          turkish: plant.turkish,
          category: plant.category,
          embedding
        });
      }
    }

    result.textContent = "Sistem hazır.";
  } catch (error) {
    result.textContent = "Başlatma hatası: " + error.message;
    console.error(error);
  }
}

async function loadImageFromUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Görsel yüklenemedi: " + src));
    img.src = src;
  });
}

async function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Yüklenen görsel okunamadı."));
    img.src = URL.createObjectURL(file);
  });
}

async function getEmbedding(img) {
  return tf.tidy(() => model.infer(img, true).clone());
}

function cosineSimilarity(a, b) {
  return tf.tidy(() => {
    const af = a.flatten();
    const bf = b.flatten();
    const dot = af.mul(bf).sum();
    const normA = af.norm();
    const normB = bf.norm();
    return dot.div(normA.mul(normB)).dataSync()[0];
  });
}

init();