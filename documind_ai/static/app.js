(() => {
  "use strict";

  const uploadZone = document.getElementById("uploadZone");
  const fileInput = document.getElementById("fileInput");
  const fileNameEl = document.getElementById("fileName");
  const textInput = document.getElementById("textInput");
  const actionBar = document.getElementById("actionBar");
  const lengthControl = document.getElementById("lengthControl");
  const lengthSelect = document.getElementById("lengthSelect");
  const toneControl = document.getElementById("toneControl");
  const toneSelect = document.getElementById("toneSelect");
  const questionControl = document.getElementById("questionControl");
  const questionInput = document.getElementById("questionInput");
  const runBtn = document.getElementById("runBtn");
  const errorBanner = document.getElementById("errorBanner");
  const resultBody = document.getElementById("resultBody");
  const resultActions = document.getElementById("resultActions");
  const copyBtn = document.getElementById("copyBtn");
  const downloadBtn = document.getElementById("downloadBtn");

  const RUN_LABELS = {
    summarize: "Summarize document",
    key_points: "Extract key points",
    ask: "Ask question",
    rewrite: "Rewrite passage",
  };

  let selectedFile = null;
  let selectedAction = null;
  let lastResultText = "";

  // ---------------- Upload zone ----------------

  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((evt) =>
    uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadZone.classList.add("drag-over");
    })
  );

  ["dragleave", "drop"].forEach((evt) =>
    uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadZone.classList.remove("drag-over");
    })
  );

  uploadZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) setSelectedFile(fileInput.files[0]);
  });

  function setSelectedFile(file) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      showError("Please choose a PDF file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showError("File too large — 10 MB max.");
      return;
    }
    selectedFile = file;
    fileNameEl.textContent = `Selected: ${file.name}`;
    textInput.value = "";
    hideError();
    updateRunButton();
  }

  textInput.addEventListener("input", () => {
    if (textInput.value.trim()) {
      selectedFile = null;
      fileInput.value = "";
      fileNameEl.textContent = "";
    }
    updateRunButton();
  });

  // ---------------- Action selection ----------------

  actionBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".action-btn");
    if (!btn) return;
    selectedAction = btn.dataset.action;

    [...actionBar.children].forEach((b) => b.classList.toggle("selected", b === btn));

    lengthControl.hidden = selectedAction !== "summarize";
    toneControl.hidden = selectedAction !== "rewrite";
    questionControl.hidden = selectedAction !== "ask";

    updateRunButton();
  });

  questionInput.addEventListener("input", updateRunButton);

  function hasDocumentInput() {
    return !!selectedFile || textInput.value.trim().length > 0;
  }

  function updateRunButton() {
    if (!selectedAction) {
      runBtn.disabled = true;
      runBtn.textContent = "Choose an action above";
      return;
    }
    if (!hasDocumentInput()) {
      runBtn.disabled = true;
      runBtn.textContent = "Upload a PDF or paste text first";
      return;
    }
    if (selectedAction === "ask" && !questionInput.value.trim()) {
      runBtn.disabled = true;
      runBtn.textContent = "Type your question";
      return;
    }
    runBtn.disabled = false;
    runBtn.textContent = RUN_LABELS[selectedAction];
  }

  // ---------------- Errors ----------------

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.hidden = false;
  }

  function hideError() {
    errorBanner.hidden = true;
    errorBanner.textContent = "";
  }

  // ---------------- Run ----------------

  runBtn.addEventListener("click", runAction);

  async function runAction() {
    hideError();
    runBtn.disabled = true;
    resultActions.hidden = true;
    lastResultText = "";

    resultBody.classList.remove("streaming");
    resultBody.innerHTML = `<div class="loading-row"><span class="spinner" aria-hidden="true"></span><span>Analyzing your document…</span></div>`;

    const formData = new FormData();
    let endpoint = "/api/analyze";

    if (selectedFile) {
      formData.append("file", selectedFile);
    } else {
      formData.append("text", textInput.value.trim());
    }

    if (selectedAction === "ask") {
      endpoint = "/api/ask";
      formData.append("question", questionInput.value.trim());
    } else {
      formData.append("action", selectedAction);
      if (selectedAction === "summarize") formData.append("length", lengthSelect.value);
      if (selectedAction === "rewrite") formData.append("tone", toneSelect.value);
    }

    try {
      const response = await fetch(endpoint, { method: "POST", body: formData });

      if (!response.ok) {
        let detail = "Something went wrong. Please try again.";
        try {
          const data = await response.json();
          detail = data.detail || detail;
        } catch (_) { /* ignore parse failure, use default message */ }
        throw new Error(detail);
      }

      resultBody.textContent = "";
      resultBody.classList.add("streaming");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        resultBody.textContent = full;
        resultBody.scrollTop = resultBody.scrollHeight;
      }

      resultBody.classList.remove("streaming");
      lastResultText = full;
      resultActions.hidden = false;
    } catch (err) {
      resultBody.classList.remove("streaming");
      resultBody.innerHTML = `<p class="placeholder">The response couldn't be completed.</p>`;
      showError(err.message || "Network error — please check your connection and try again.");
    } finally {
      updateRunButton();
    }
  }

  // ---------------- Copy / Download ----------------

  copyBtn.addEventListener("click", async () => {
    if (!lastResultText) return;
    try {
      await navigator.clipboard.writeText(lastResultText);
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = original), 1500);
    } catch (_) {
      showError("Couldn't copy to clipboard. Please select and copy the text manually.");
    }
  });

  downloadBtn.addEventListener("click", () => {
    if (!lastResultText) return;
    const blob = new Blob([lastResultText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "documind-result.txt";
    a.click();
    URL.revokeObjectURL(url);
  });
})();