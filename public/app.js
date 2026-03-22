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
    result.textContent = "Lütfen önce bir bitki fotoğrafı yükle.";
    return;
  }

  if (!model) {
    result.innerHTML = "<span class='loading'>Model henüz hazır değil, biraz bekle.</span>";
    return;
  }

  try {
    result.innerHTML = "<span class='loading'>Fotoğraf analiz ediliyor...</span>";

    const uploadedImg = await loadImageFromFile(selectedFile);
    const uploadedEmbedding = await getEmbedding(uploadedImg);

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

    const base64 = await fileToBase64(selectedFile);

    const localResult = {
      name: bestMatch.name,
      turkish: bestMatch.turkish,
      category: bestMatch.category,
      score: bestScore
    };

    const apiResponse = await fetch("/api/identify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imageBase64: base64,
        localResult
      })
    });

    const apiData = await apiResponse.json();

    if (!apiResponse.ok) {
      result.textContent = `Hata: ${apiData.error || "Bilinmeyen hata"}`;
      return;
    }

    if (apiData.source === "local") {
      result.textContent =
        `Bitki Adı: ${apiData.data.name}\n` +
        `Türkçe Adı: ${apiData.data.turkish}\n` +
        `Kategori: ${apiData.data.category}\n` +
        `Kaynak: Sistem veritabanı\n` +
        `Benzerlik: %${(apiData.data.score * 100).toFixed(2)}\n` +
        `Not: Bu bitki sistem içerisindeki kayıtlarla uyuşuyor.`;
      return;
    }

    if (apiData.source === "plantnet") {
      const common =
        apiData.data.commonNames && apiData.data.commonNames.length
          ? apiData.data.commonNames.join(", ")
          : "Yok";

      result.textContent =
        `Bitki Adı: ${apiData.data.name}\n` +
        `Aile: ${apiData.data.family}\n` +
        `Yaygın Adlar: ${common}\n` +
        `Kaynak: İnternet destekli tanıma (Pl@ntNet)\n` +
        `Güven: %${(apiData.data.score * 100).toFixed(2)}\n` +
        `Not: Yerel veritabanında güçlü eşleşme bulunamadı, sonuç internetten doğrulandı.`;
      return;
    }

    if (apiData.source === "none") {
      result.textContent = "Bitki bulunamadı.";
      return;
    }

    result.textContent = "Sonuç alınamadı.";
  } catch (error) {
    result.textContent = "Bir hata oluştu: " + error.message;
    console.error(error);
  }
});

async function init() {
  try {
    result.innerHTML = "<span class='loading'>Model yükleniyor...</span>";

    model = await mobilenet.load({ version: 2, alpha: 1.0 });

    const response = await fetch("/api/plants");
    const data = await response.json();

    plantsData = data.plants;

    result.innerHTML = "<span class='loading'>Veritabanı görselleri hazırlanıyor...</span>";

    for (const plant of plantsData) {
      for (const imageName of plant.images) {
        const imgPath = `/images/${imageName}`;
        const img = await loadImageFromUrl(imgPath);
        const embedding = await getEmbedding(img);

        datasetEmbeddings.push({
          name: plant.name,
          turkish: plant.turkish,
          category: plant.category,
          image: imgPath,
          embedding
        });
      }
    }

    result.textContent = "Sistem hazır. Şimdi bir bitki fotoğrafı yükleyebilirsin.";
  } catch (error) {
    result.textContent = "Başlatma hatası: " + error.message;
    console.error(error);
  }
}

async function loadImageFromUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
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

async function getEmbedding(imgElement) {
  return tf.tidy(() => {
    const embedding = model.infer(imgElement, true);
    return embedding.clone();
  });
}

function cosineSimilarity(tensorA, tensorB) {
  return tf.tidy(() => {
    const a = tensorA.flatten();
    const b = tensorB.flatten();
    const dot = a.mul(b).sum();
    const normA = a.norm();
    const normB = b.norm();
    const similarity = dot.div(normA.mul(normB));
    return similarity.dataSync()[0];
  });
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Dosya base64'e çevrilemedi."));
    reader.readAsDataURL(file);
  });
}

init();