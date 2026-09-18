// ── Dashboard Platform Selection & Toggle Fields ─────────────────────────────
function togglePlatformFields() {
  const selectedPlats = Array.from(document.querySelectorAll('.platform-checkbox:checked')).map(cb => cb.value);
  const detailsCard = document.getElementById('platform-details-card');
  
  if (detailsCard) {
    detailsCard.style.display = selectedPlats.length > 0 ? 'block' : 'none';
  }
  
  ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest'].forEach(plat => {
    const detailSection = document.getElementById('detail-' + plat);
    if (detailSection) {
      detailSection.style.display = selectedPlats.includes(plat) ? 'block' : 'none';
    }
  });
  
  updatePublishButtonState();
}

function togglePlatformPublish(platform) {
  const toggleInput = document.getElementById("toggle-publish-" + platform);
  const detailSection = document.getElementById("detail-" + platform);
  const lbl = document.getElementById("toggle-lbl-" + platform);
  
  if (!toggleInput || !detailSection) return;

  if (toggleInput.checked) {
    detailSection.classList.remove("disabled-platform");
    if (lbl) lbl.textContent = "Publishing Enabled";
  } else {
    detailSection.classList.add("disabled-platform");
    if (lbl) lbl.textContent = "Publishing Excluded";
  }
  updatePublishButtonState();
}

function getEnabledPlatforms() {
  const checkboxes = Array.from(document.querySelectorAll('.platform-checkbox:checked'));
  return checkboxes
    .map(cb => cb.value)
    .filter(plat => {
      const toggle = document.getElementById('toggle-publish-' + plat);
      return !toggle || toggle.checked;
    });
}

function updatePublishButtonState() {
  const enabledPlats = getEnabledPlatforms();
  const fileInput = document.getElementById('dash-file-input');
  const publishBtn = document.getElementById('dash-publish-btn');
  const hasFile = fileInput && fileInput.files && fileInput.files[0];
  
  if (publishBtn) {
    publishBtn.disabled = !(enabledPlats.length > 0 && hasFile);
  }
}

// ── Preview helper ───────────────────────────────────────────────────────────
function renderPreview(file, containerId) {
  const container = document.getElementById(containerId);
  if (!container || !file) return;
  
  container.innerHTML = "";
  const reader = new FileReader();
  
  if (file.type.startsWith("video/")) {
    reader.onload = function(e) {
      container.innerHTML = `<video src="${e.target.result}" controls style="width: 100%; max-height: 260px; object-fit: cover; display: block;"></video>`;
    };
  } else {
    reader.onload = function(e) {
      container.innerHTML = `<img src="${e.target.result}" alt="preview" style="width: 100%; max-height: 260px; object-fit: cover; display: block;" />`;
    };
  }
  reader.readAsDataURL(file);
}

// ── AI Field Adjustment ──────────────────────────────────────────────────────
async function adjustSingleField(platform, field, mode, btnEl) {
  const fileInput = document.getElementById("dash-file-input");
  const file = fileInput?.files?.[0];
  const contextPrompt = document.getElementById("ai-dash-prompt")?.value || "";
  
  let targetId = "";
  if (platform === "facebook") {
    targetId = field === "caption" ? "fb-dash-caption" : "fb-dash-hashtags";
  } else if (platform === "instagram") {
    targetId = field === "caption" ? "ig-dash-caption" : "ig-dash-hashtags";
  } else if (platform === "youtube") {
    if (field === "title") targetId = "yt-dash-title";
    else if (field === "description") targetId = "yt-dash-description";
    else targetId = "yt-dash-hashtags";
  } else if (platform === "tiktok") {
    targetId = field === "caption" ? "tk-dash-caption" : "tk-dash-hashtags";
  } else if (platform === "pinterest") {
    if (field === "title") targetId = "pin-dash-title";
    else if (field === "description") targetId = "pin-dash-description";
    else targetId = "pin-dash-hashtags";
  }

  const targetEl = document.getElementById(targetId);
  if (!targetEl) return;

  const currentText = targetEl.value || "";
  const spinner = btnEl.querySelector(".spinner");

  btnEl.disabled = true;
  if (spinner) spinner.style.display = "inline-block";

  try {
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("platform", platform);
    fd.append("field", field);
    fd.append("mode", mode);
    fd.append("current_text", currentText);
    fd.append("context_prompt", contextPrompt);

    const res = await fetch("/api/generate-single", { method: "POST", body: fd });
    const data = await res.json();

    if (data.success && data.text) {
      targetEl.value = data.text;
      targetEl.style.borderColor = "#1877f2";
      setTimeout(() => { targetEl.style.borderColor = ""; }, 1000);
    } else {
      alert("❌ " + (data.message || "Could not generate content. Check your OpenAI API Key in AI Settings."));
    }
  } catch (err) {
    alert("❌ Network error while communicating with AI service.");
  } finally {
    btnEl.disabled = false;
    if (spinner) spinner.style.display = "none";
  }
}

function copyFieldText(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.value || "";
  if (!text) {
    alert("Nothing to copy.");
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    if (window.event && window.event.currentTarget) {
      const btn = window.event.currentTarget;
      const origText = btn.innerHTML;
      btn.innerHTML = "✅ Copied!";
      setTimeout(() => { btn.innerHTML = origText; }, 1500);
    }
  }).catch(() => {
    alert("Failed to copy text.");
  });
}

function clearFieldText(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.value = "";
}

// ── Multi-Platform Publish & Schedule Action ─────────────────────────────────
async function dashPublish() {
  const successEl = document.getElementById("dash-publish-success");
  const errorEl   = document.getElementById("dash-publish-error");
  const submitBtn = document.getElementById("dash-publish-btn");
  const spinner   = document.getElementById("dash-publish-spinner");
  const btnTxt    = document.getElementById("dash-publish-text");
  const fileInput = document.getElementById("dash-file-input");

  if (!successEl || !errorEl || !submitBtn || !fileInput) return;

  successEl.style.display = "none";
  errorEl.style.display   = "none";
  successEl.innerHTML = "";
  errorEl.innerHTML = "";

  const file = fileInput.files[0];
  if (!file) {
    errorEl.textContent = "Please select a file first.";
    errorEl.style.display = "block";
    return;
  }

  const selectedPlats = getEnabledPlatforms();
  if (selectedPlats.length === 0) {
    errorEl.textContent = "Please select and enable at least one platform to publish to.";
    errorEl.style.display = "block";
    return;
  }

  const isVideoFile = file.type.startsWith("video/") || /mp4|mov|avi|mkv|webm|m4v|3gp|flv|wmv/i.test(file.name);
  if (!isVideoFile) {
    if (selectedPlats.includes("youtube")) {
      errorEl.textContent = "❌ YouTube only supports video publishing. Please select a video file or uncheck YouTube.";
      errorEl.style.display = "block";
      return;
    }
    if (selectedPlats.includes("tiktok")) {
      errorEl.textContent = "❌ TikTok only supports video publishing. Please select a video file or uncheck TikTok.";
      errorEl.style.display = "block";
      return;
    }
  }

  submitBtn.disabled = true;
  if (spinner) spinner.style.display = "inline-block";
  if (btnTxt) btnTxt.textContent = "Publishing…";

  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("platforms", JSON.stringify(selectedPlats));

    if (selectedPlats.includes("facebook")) {
      fd.append("fb_caption", document.getElementById("fb-dash-caption")?.value || "");
      fd.append("fb_hashtags", document.getElementById("fb-dash-hashtags")?.value || "");
    }
    if (selectedPlats.includes("instagram")) {
      fd.append("ig_caption", document.getElementById("ig-dash-caption")?.value || "");
      fd.append("ig_hashtags", document.getElementById("ig-dash-hashtags")?.value || "");
      fd.append("image_url", document.getElementById("ig-dash-url")?.value || "");
    }
    if (selectedPlats.includes("youtube")) {
      fd.append("yt_title", document.getElementById("yt-dash-title")?.value || "");
      fd.append("yt_description", document.getElementById("yt-dash-description")?.value || "");
      fd.append("yt_tags", document.getElementById("yt-dash-hashtags")?.value || "");
    }
    if (selectedPlats.includes("tiktok")) {
      fd.append("tk_caption", document.getElementById("tk-dash-caption")?.value || "");
      fd.append("tk_hashtags", document.getElementById("tk-dash-hashtags")?.value || "");
    }
    if (selectedPlats.includes("pinterest")) {
      fd.append("pin_title", document.getElementById("pin-dash-title")?.value || "");
      fd.append("pin_description", document.getElementById("pin-dash-description")?.value || "");
      fd.append("pin_hashtags", document.getElementById("pin-dash-hashtags")?.value || "");
    }

    const res = await fetch("/api/publish-multi", { method: "POST", body: fd });
    const data = await res.json();
    
    if (data.success && data.results) {
      let successHtml = "<strong>Publishing Results:</strong><ul style='margin-top:8px;padding-left:16px;line-height:1.6'>";
      let errorHtml = "<strong>Failed Destinations:</strong><ul style='margin-top:8px;padding-left:16px;line-height:1.6'>";
      let hasSuccess = false;
      let hasError = false;

      for (const [platform, result] of Object.entries(data.results)) {
        const title = platform.charAt(0).toUpperCase() + platform.slice(1);
        if (result.success) {
          hasSuccess = true;
          successHtml += `<li>✅ <strong>${title}</strong>: ${result.message} ${result.post_id ? `(ID: ${result.post_id})` : ''}</li>`;
        } else {
          hasError = true;
          errorHtml += `<li>❌ <strong>${title}</strong>: ${result.message}</li>`;
        }
      }
      successHtml += "</ul>";
      errorHtml += "</ul>";

      if (hasSuccess) {
        successEl.innerHTML = successHtml;
        successEl.style.display = "block";
      }
      if (hasError) {
        errorEl.innerHTML = errorHtml;
        errorEl.style.display = "block";
      }

      if (!hasError) {
        fileInput.value = "";
        document.getElementById("dash-media-preview").innerHTML = "";
        document.getElementById("dash-preview-wrap").style.display = "none";
        document.getElementById("dash-drop-zone").style.display = "block";

        document.querySelectorAll(".platform-checkbox").forEach(cb => cb.checked = false);
        togglePlatformFields();
      }
    } else {
      errorEl.textContent = "❌ " + (data.message || "Unknown publishing error occurred.");
      errorEl.style.display = "block";
    }
  } catch (e) {
    errorEl.textContent = "❌ Network error. Is the server running?";
    errorEl.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    if (spinner) spinner.style.display = "none";
    if (btnTxt) btnTxt.textContent = currentPublishMode === "schedule" ? "📅 Schedule Post for Later" : "🚀 Publish to Selected Platforms";
  }
}

let currentPublishMode = "now";

function setPublishMode(mode) {
  currentPublishMode = mode;
  const cardNow = document.getElementById("mode-card-now");
  const cardSchedule = document.getElementById("mode-card-schedule");
  const globalBox = document.getElementById("global-schedule-box");
  const btnTxt = document.getElementById("dash-publish-text");

  if (!cardNow || !cardSchedule || !globalBox) return;

  if (mode === "schedule") {
    cardSchedule.classList.add("active");
    cardNow.classList.remove("active");
    globalBox.style.display = "block";
    if (btnTxt) btnTxt.textContent = "📅 Schedule Post for Later";

    const dtPicker = document.getElementById("global-schedule-datetime");
    if (dtPicker && !dtPicker.value) {
      const defaultTime = new Date(Date.now() + 3600000);
      const isoLocal = new Date(defaultTime.getTime() - (defaultTime.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
      dtPicker.value = isoLocal;
    }
  } else {
    cardNow.classList.add("active");
    cardSchedule.classList.remove("active");
    globalBox.style.display = "none";
    if (btnTxt) btnTxt.textContent = "🚀 Publish to Selected Platforms";
  }
}

function applyGlobalSchedule() {
  const globalVal = document.getElementById("global-schedule-datetime")?.value;
  if (!globalVal) {
    alert("Please select a date and time first.");
    return;
  }
  ['facebook', 'instagram', 'youtube', 'tiktok', 'pinterest'].forEach(plat => {
    const input = document.getElementById("sched-time-" + plat);
    if (input) input.value = globalVal;
  });
}

function handlePublishOrScheduleAction() {
  if (currentPublishMode === "schedule") {
    schedulePost();
  } else {
    dashPublish();
  }
}

async function schedulePost() {
  const successEl = document.getElementById("dash-publish-success");
  const errorEl   = document.getElementById("dash-publish-error");
  const submitBtn = document.getElementById("dash-publish-btn");
  const spinner   = document.getElementById("dash-publish-spinner");
  const btnTxt    = document.getElementById("dash-publish-text");
  const fileInput = document.getElementById("dash-file-input");

  if (!successEl || !errorEl || !submitBtn || !fileInput) return;

  successEl.style.display = "none";
  errorEl.style.display   = "none";
  successEl.innerHTML = "";
  errorEl.innerHTML = "";

  const file = fileInput.files[0];
  if (!file) {
    errorEl.textContent = "Please select a file first.";
    errorEl.style.display = "block";
    return;
  }

  const selectedPlats = getEnabledPlatforms();
  if (selectedPlats.length === 0) {
    errorEl.textContent = "Please select and enable at least one platform to schedule for.";
    errorEl.style.display = "block";
    return;
  }

  const isVideoFile = file.type.startsWith("video/") || /mp4|mov|avi|mkv|webm|m4v|3gp|flv|wmv/i.test(file.name);
  if (!isVideoFile) {
    if (selectedPlats.includes("youtube")) {
      errorEl.textContent = "❌ YouTube only supports video publishing. Please select a video file or uncheck YouTube.";
      errorEl.style.display = "block";
      return;
    }
    if (selectedPlats.includes("tiktok")) {
      errorEl.textContent = "❌ TikTok only supports video publishing. Please select a video file or uncheck TikTok.";
      errorEl.style.display = "block";
      return;
    }
  }

  const schedules = {};
  const globalTime = document.getElementById("global-schedule-datetime")?.value;

  for (const plat of selectedPlats) {
    const platTime = document.getElementById("sched-time-" + plat)?.value;
    if (platTime) {
      schedules[plat] = platTime;
    } else if (globalTime) {
      schedules[plat] = globalTime;
    } else {
      errorEl.textContent = `Please set a schedule time for ${plat.toUpperCase()} or use the Bulk Schedule picker.`;
      errorEl.style.display = "block";
      return;
    }
  }

  submitBtn.disabled = true;
  if (spinner) spinner.style.display = "inline-block";
  if (btnTxt) btnTxt.textContent = "Scheduling…";

  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("platforms", JSON.stringify(selectedPlats));
    fd.append("schedules", JSON.stringify(schedules));
    if (globalTime) fd.append("global_schedule_time", globalTime);

    if (selectedPlats.includes("facebook")) {
      fd.append("fb_caption", document.getElementById("fb-dash-caption")?.value || "");
      fd.append("fb_hashtags", document.getElementById("fb-dash-hashtags")?.value || "");
    }
    if (selectedPlats.includes("instagram")) {
      fd.append("ig_caption", document.getElementById("ig-dash-caption")?.value || "");
      fd.append("ig_hashtags", document.getElementById("ig-dash-hashtags")?.value || "");
      fd.append("image_url", document.getElementById("ig-dash-url")?.value || "");
    }
    if (selectedPlats.includes("youtube")) {
      fd.append("yt_title", document.getElementById("yt-dash-title")?.value || "");
      fd.append("yt_description", document.getElementById("yt-dash-description")?.value || "");
      fd.append("yt_tags", document.getElementById("yt-dash-hashtags")?.value || "");
    }
    if (selectedPlats.includes("tiktok")) {
      fd.append("tk_caption", document.getElementById("tk-dash-caption")?.value || "");
      fd.append("tk_hashtags", document.getElementById("tk-dash-hashtags")?.value || "");
    }
    if (selectedPlats.includes("pinterest")) {
      fd.append("pin_title", document.getElementById("pin-dash-title")?.value || "");
      fd.append("pin_description", document.getElementById("pin-dash-description")?.value || "");
      fd.append("pin_hashtags", document.getElementById("pin-dash-hashtags")?.value || "");
    }

    const res = await fetch("/api/schedule-post", { method: "POST", body: fd });
    const data = await res.json();

    if (data.success) {
      let schedDetails = `<div style="font-weight:700;margin-bottom:6px">🎉 ${data.message}</div><ul style="padding-left:16px;line-height:1.6">`;
      for (const [plat, info] of Object.entries(data.post.platforms)) {
        const title = plat.charAt(0).toUpperCase() + plat.slice(1);
        const formattedTime = new Date(info.scheduledAt).toLocaleString();
        schedDetails += `<li>📅 <strong>${title}</strong>: Scheduled for ${formattedTime}</li>`;
      }
      schedDetails += `</ul><div style="margin-top:8px"><button class="btn-secondary" onclick="goTo('scheduled-posts')" style="font-size:12px;padding:4px 10px">View Scheduled Posts</button></div>`;

      successEl.innerHTML = schedDetails;
      successEl.style.display = "block";

      fileInput.value = "";
      document.getElementById("dash-media-preview").innerHTML = "";
      document.getElementById("dash-preview-wrap").style.display = "none";
      document.getElementById("dash-drop-zone").style.display = "block";

      document.querySelectorAll(".platform-checkbox").forEach(cb => cb.checked = false);
      togglePlatformFields();
    } else {
      errorEl.textContent = "❌ " + (data.message || "Failed to schedule post.");
      errorEl.style.display = "block";
    }
  } catch (err) {
    errorEl.textContent = "❌ Network error scheduling post.";
    errorEl.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    if (spinner) spinner.style.display = "none";
    if (btnTxt) btnTxt.textContent = "📅 Schedule Post for Later";
  }
}

async function generateAiContent() {
  const successEl = document.getElementById("ai-gen-success");
  const errorEl   = document.getElementById("ai-gen-error");
  const submitBtn = document.getElementById("ai-gen-btn");
  const spinner   = document.getElementById("ai-gen-spinner");
  const btnTxt    = document.getElementById("ai-gen-text");
  const fileInput = document.getElementById("dash-file-input");

  if (!successEl || !errorEl || !submitBtn) return;

  successEl.style.display = "none";
  errorEl.style.display   = "none";
  successEl.textContent = "";
  errorEl.textContent = "";

  const selectedPlats = getEnabledPlatforms();
  if (selectedPlats.length === 0) {
    errorEl.textContent = "Please select and enable at least one platform before generating content.";
    errorEl.style.display = "block";
    return;
  }

  submitBtn.disabled = true;
  if (spinner) spinner.style.display = "inline-block";
  if (btnTxt) btnTxt.textContent = "Generating Content…";

  try {
    const fd = new FormData();
    const file = fileInput?.files?.[0];
    if (file) {
      fd.append("file", file);
    }
    fd.append("platforms", JSON.stringify(selectedPlats));
    fd.append("context_prompt", document.getElementById("ai-dash-prompt")?.value || "");

    const res = await fetch("/api/generate-content", { method: "POST", body: fd });
    const data = await res.json();
    
    if (data.success && data.generated) {
      const generated = data.generated;
      
      if (generated.facebook) {
        if (document.getElementById("fb-dash-caption")) document.getElementById("fb-dash-caption").value = generated.facebook.caption || "";
        if (document.getElementById("fb-dash-hashtags")) document.getElementById("fb-dash-hashtags").value = generated.facebook.hashtags || "";
      }
      if (generated.instagram) {
        if (document.getElementById("ig-dash-caption")) document.getElementById("ig-dash-caption").value = generated.instagram.caption || "";
        if (document.getElementById("ig-dash-hashtags")) document.getElementById("ig-dash-hashtags").value = generated.instagram.hashtags || "";
      }
      if (generated.youtube) {
        if (document.getElementById("yt-dash-title")) document.getElementById("yt-dash-title").value = generated.youtube.title || "";
        if (document.getElementById("yt-dash-description")) document.getElementById("yt-dash-description").value = generated.youtube.description || "";
        if (document.getElementById("yt-dash-hashtags")) document.getElementById("yt-dash-hashtags").value = generated.youtube.tags || generated.youtube.hashtags || "";
      }
      if (generated.tiktok) {
        if (document.getElementById("tk-dash-caption")) document.getElementById("tk-dash-caption").value = generated.tiktok.caption || "";
        if (document.getElementById("tk-dash-hashtags")) document.getElementById("tk-dash-hashtags").value = generated.tiktok.hashtags || "";
      }
      if (generated.pinterest) {
        if (document.getElementById("pin-dash-title")) document.getElementById("pin-dash-title").value = generated.pinterest.title || "";
        if (document.getElementById("pin-dash-description")) document.getElementById("pin-dash-description").value = generated.pinterest.description || "";
        if (document.getElementById("pin-dash-hashtags")) document.getElementById("pin-dash-hashtags").value = generated.pinterest.hashtags || "";
      }

      successEl.textContent = "✨ Content generated & populated successfully!";
      successEl.style.display = "block";
    } else {
      errorEl.textContent = "❌ " + (data.message || "Failed to generate captions.");
      errorEl.style.display = "block";
    }
  } catch (err) {
    errorEl.textContent = "❌ Network error. Is the server running?";
    errorEl.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    if (spinner) spinner.style.display = "none";
    if (btnTxt) btnTxt.textContent = "✨ Auto-Generate Captions & Hashtags";
  }
}

// Bind Drag & Drop & File Input handlers on DOM Load
document.addEventListener("DOMContentLoaded", () => {
  const dashFileInput  = document.getElementById("dash-file-input");
  const dashDropZone   = document.getElementById("dash-drop-zone");
  const dashPreviewWrap= document.getElementById("dash-preview-wrap");
  const dashRemoveBtn  = document.getElementById("dash-remove-btn");

  function handleDashFileChange() {
    const file = dashFileInput?.files?.[0];
    if (!file) return;
    renderPreview(file, "dash-media-preview");
    if (dashPreviewWrap) dashPreviewWrap.style.display = "block";
    if (dashDropZone)    dashDropZone.style.display    = "none";
    updatePublishButtonState();
    
    const sEl = document.getElementById("dash-publish-success");
    const eEl = document.getElementById("dash-publish-error");
    if (sEl) sEl.style.display = "none";
    if (eEl) eEl.style.display = "none";
  }

  dashDropZone?.addEventListener("dragover",  e => { e.preventDefault(); dashDropZone.classList.add("dragover"); });
  dashDropZone?.addEventListener("dragleave", ()  => dashDropZone.classList.remove("dragover"));
  dashDropZone?.addEventListener("drop",      e  => {
    e.preventDefault();
    dashDropZone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0] && dashFileInput) {
      dashFileInput.files = e.dataTransfer.files;
      handleDashFileChange();
    }
  });

  dashFileInput?.addEventListener("change", handleDashFileChange);

  dashRemoveBtn?.addEventListener("click", () => {
    if (dashFileInput) dashFileInput.value = "";
    const previewContainer = document.getElementById("dash-media-preview");
    if (previewContainer) previewContainer.innerHTML = "";
    if (dashPreviewWrap) dashPreviewWrap.style.display = "none";
    if (dashDropZone)    dashDropZone.style.display    = "block";
    updatePublishButtonState();
  });
});
