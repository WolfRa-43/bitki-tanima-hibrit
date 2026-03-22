let model;
let plantsData = [];
let datasetEmbeddings = [];

const inputs = [
  document.getElementById("imageInput1"),
  document.getElementById("imageInput2"),
  document.getElementById("imageInput3")
];

const previews = [
  document.getElementById("preview1"),
  document.getElementById("preview2"),
  document.getElementById("preview3")
];

const analyzeBtn = document.getElementById("analyzeBtn");
const progressText = document.getElementById("progressText");
const spinner = document.getElementById("spinner");
const localResultBox = document.getElementById("localResult");
const plantnetResultBox = document.getElementById("plantnetResult");

inputs.forEach((input, index) => {
  input.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
      previews[index].src = URL.createObjectURL(file);
      previews[index].style.display = "block";
    }
  });
});

analyzeBtn.addEventListener("click", async () => {
  const selectedFiles = inputs
    .map((input) => input.files[0])
    .filter(Boolean);

  if (selectedFiles.length === 0) {
    setError("En az bir görsel yüklemelisin.");
    return;
  }

  try {
    setLoading(true, "1/5 Görseller okunuyor...");

    const localScores = [];

    for (const file of selectedFiles) {
      const uploadedImg = await loadImageFromFile(file);
      const uploadedEmbedding = await getEmbedding(uploadedImg);

      setLoading(true, "2/5 Yerel veri tabanı ile karşılaştırılıyor...");

      let bestMatch = null;
      let bestScore = -1;

      for (const item of datasetEmbeddings) {
        const score = cosineSimilarity(uploadedEmbedding, item.embedding);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = item;
        }
      }

      if (bestMatch) {
        localScores.push({
          name: bestMatch.name,
          turkish: bestMatch.turkish,
          category: bestMatch.category,
          score: bestScore
        });
      }
    }

    const mergedLocal = mergeLocalResults(localScores);
    renderLocalResult(mergedLocal);

    setLoading(true, "3/5 İnternet destekli tanıma hazırlanıyor...");

    const formData = new FormData();
    selectedFiles.forEach((file, index) => {
      formData.append(`image${index + 1}`, file);
    });

    formData.append("localName", mergedLocal.name || "");
    formData.append("localTurkish", mergedLocal.turkish || "");
    formData.append("localCategory", mergedLocal.category || "");
    formData.append("localScore", String(mergedLocal.score || 0));

    setLoading(true, "4/5 PlantNet ile analiz ediliyor...");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);

    const response = await fetch("/api/identify", {
      method: "POST",
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Bilinmeyen sunucu hatası");
    }

    setLoading(true, "5/5 Sonuçlar hazırlanıyor...");

    renderLocalResult(data.local || mergedLocal);
    renderPlantnetResult(data.plantnet);

    setLoading(false, "Analiz tamamlandı.");
  } catch (error) {
    if (error.name === "AbortError") {
      setError("İstek zaman aşımına uğradı. Lütfen daha net veya daha küçük boyutlu görseller dene.");
      return;
    }

    setError(error.message || "Bir hata oluştu.");
  }
});

async function init() {
  try {
    setLoading(true, "Model yükleniyor...");

    model = await mobilenet.load();

    setLoading(true, "Bitki verileri alınıyor...");

    const response = await fetch("/api/plants");
    const data = await response.json();
    plantsData = data.plants;

    setLoading(true, "Referans görseller hazırlanıyor...");

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

    setLoading(false, "Sistem hazır. Görselleri yükleyebilirsin.");
  } catch (error) {
    setError("Başlatma hatası: " + error.message);
  }
}

function mergeLocalResults(results) {
  if (!results.length) {
    return {
      name: "Bilinmiyor",
      turkish: "Bilinmiyor",
      category: "Bilinmiyor",
      score: 0
    };
  }

  const grouped = {};

  for (const item of results) {
    const key = `${item.name}|${item.turkish}|${item.category}`;
    if (!grouped[key]) {
      grouped[key] = {
        ...item,
        total: item.score,
        count: 1
      };
    } else {
      grouped[key].total += item.score;
      grouped[key].count += 1;
    }
  }

  const merged = Object.values(grouped).map((item) => ({
    name: item.name,
    turkish: item.turkish,
    category: item.category,
    score: item.total / item.count
  }));

  merged.sort((a, b) => b.score - a.score);
  return merged[0];
}

function getConfidenceMeta(score) {
  const percent = score * 100;

  if (percent >= 80) {
    return { label: "Yüksek Güven", color: "green" };
  }
  if (percent >= 60) {
    return { label: "Orta Güven", color: "yellow" };
  }
  return { label: "Düşük Güven", color: "red" };
}

function renderLocalResult(local) {
  if (!local) {
    localResultBox.innerHTML = `<div class="empty-state">Yerel sonuç yok.</div>`;
    return;
  }

  const meta = getConfidenceMeta(local.score || 0);

  localResultBox.innerHTML = `
    <div class="result-block">
      <div class="result-main">
        <div class="result-line"><strong>Bilimsel Ad:</strong> ${escapeHtml(local.name || "Bilinmiyor")}</div>
        <div class="result-line"><strong>Türkçe Ad:</strong> ${escapeHtml(local.turkish || "Bilinmiyor")}</div>
        <div class="result-line"><strong>Kategori:</strong> ${escapeHtml(local.category || "Bilinmiyor")}</div>
        <div class="result-line"><strong>Benzerlik:</strong> %${((local.score || 0) * 100).toFixed(2)}</div>
        <div class="badge-row">
          <span class="badge ${meta.color}">${meta.label}</span>
          <span class="badge green">Kaynak: Yerel Veri Tabanı</span>
        </div>
      </div>
    </div>
  `;
}

function renderPlantnetResult(plantnet) {
  if (!plantnet || !plantnet.candidates || !plantnet.candidates.length) {
    plantnetResultBox.innerHTML = `<div class="empty-state">PlantNet sonucu bulunamadı.</div>`;
    return;
  }

  const top = plantnet.candidates[0];
  const topMeta = getConfidenceMeta(top.score || 0);

  const candidatesHtml = plantnet.candidates.map((item, index) => {
    const meta = getConfidenceMeta(item.score || 0);
    const commonNames = item.commonNames && item.commonNames.length
      ? item.commonNames.join(", ")
      : "Yok";

    return `
      <div class="candidate-card">
        <div class="candidate-title">${index + 1}. Aday — ${escapeHtml(item.name)}</div>
        <div class="result-line"><strong>Aile:</strong> ${escapeHtml(item.family || "Bilinmiyor")}</div>
        <div class="result-line"><strong>Yaygın Adlar:</strong> ${escapeHtml(commonNames)}</div>
        <div class="result-line"><strong>Güven:</strong> %${((item.score || 0) * 100).toFixed(2)}</div>
        <div class="badge-row">
          <span class="badge ${meta.color}">${meta.label}</span>
        </div>
      </div>
    `;
  }).join("");

  plantnetResultBox.innerHTML = `
    <div class="result-block">
      <div class="result-main">
        <div class="result-line"><strong>En Güçlü Sonuç:</strong> ${escapeHtml(top.name || "Bilinmiyor")}</div>
        <div class="result-line"><strong>Aile:</strong> ${escapeHtml(top.family || "Bilinmiyor")}</div>
        <div class="result-line"><strong>Güven:</strong> %${((top.score || 0) * 100).toFixed(2)}</div>
        <div class="badge-row">
          <span class="badge ${topMeta.color}">${topMeta.label}</span>
          <span class="badge green">Kaynak: PlantNet</span>
        </div>
      </div>

      <div class="candidate-list">
        ${candidatesHtml}
      </div>
    </div>
  `;
}

function setLoading(isLoading, text) {
  progressText.textContent = text;
  spinner.classList.toggle("active", isLoading);
}

function setError(message) {
  spinner.classList.remove("active");
  progressText.textContent = "Bir hata oluştu.";
  plantnetResultBox.innerHTML = `<div class="error-box">${escapeHtml(message)}</div>`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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