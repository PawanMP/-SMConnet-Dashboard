// ── Scheduled Posts Management Module ────────────────────────────────────────

async function loadScheduledPostsList() {
  const loading = document.getElementById("scheduled-posts-loading");
  const empty = document.getElementById("scheduled-posts-empty");
  const container = document.getElementById("scheduled-posts-container");

  if (!loading || !empty || !container) return;

  loading.style.display = "block";
  empty.style.display = "none";
  container.innerHTML = "";

  try {
    const res = await fetch("/api/scheduled-posts");
    const data = await res.json();
    loading.style.display = "none";

    if (!data.success || !data.posts || data.posts.length === 0) {
      empty.style.display = "block";
      return;
    }

    let html = `
      <table class="sched-table">
        <thead>
          <tr>
            <th>File / Content</th>
            <th>Created</th>
            <th>Platforms &amp; Schedule Times</th>
            <th>Overall Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.posts.forEach(post => {
      let platDetails = `<ul style="list-style:none;padding:0;margin:0;line-height:1.6">`;
      for (const [plat, item] of Object.entries(post.platforms)) {
        const icon = plat === "facebook" ? "📘" : plat === "instagram" ? "📸" : plat === "youtube" ? "📽️" : plat === "tiktok" ? "🎵" : "📌";
        const dateStr = item.scheduledAt ? new Date(item.scheduledAt).toLocaleString() : "N/A";
        const statusBadge = `<span class="badge-status ${item.status}">${item.status.toUpperCase()}</span>`;
        platDetails += `<li style="margin-bottom:4px">${icon} <strong>${plat.toUpperCase()}</strong>: ${statusBadge} <br><span style="font-size:11px;color:#65676b">🕒 ${dateStr}</span>${item.resultMessage ? `<br><span style="font-size:11px;color:#c62828">${item.resultMessage}</span>` : ''}</li>`;
      }
      platDetails += `</ul>`;

      const overallBadge = `<span class="badge-status ${post.status}">${post.status.toUpperCase()}</span>`;
      const createdStr = new Date(post.createdAt).toLocaleString();

      html += `
        <tr>
          <td>
            <strong>📁 ${post.fileName || 'Media Post'}</strong>
            <div style="font-size:11px;color:#65676b;margin-top:4px">ID: ${post.id}</div>
          </td>
          <td style="font-size:12px;color:#4b5563">${createdStr}</td>
          <td>${platDetails}</td>
          <td>${overallBadge}</td>
          <td>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${post.status === 'scheduled' ? `
                <button class="btn-primary" onclick="runScheduledPostNow('${post.id}')" style="font-size:11.5px;padding:4px 10px">▶️ Run Now</button>
                <button class="btn-secondary" onclick="cancelScheduledPost('${post.id}')" style="font-size:11.5px;padding:4px 10px;color:#c62828;border-color:#ffcdd2">❌ Cancel</button>
              ` : `
                <span style="font-size:12px;color:#8a8d91">No actions</span>
              `}
            </div>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch (e) {
    if (loading) loading.style.display = "none";
    if (container) container.innerHTML = `<div class="alert error" style="display:block">Failed to load scheduled posts.</div>`;
  }
}

async function cancelScheduledPost(id) {
  if (!confirm("Are you sure you want to cancel this scheduled post?")) return;
  try {
    const res = await fetch(`/api/scheduled-posts/${id}`, { method: "DELETE" });
    const data = await res.json();
    alert(data.message || "Cancelled.");
    loadScheduledPostsList();
  } catch (e) {
    alert("Failed to cancel post.");
  }
}

async function runScheduledPostNow(id) {
  if (!confirm("Execute this scheduled post immediately?")) return;
  try {
    const res = await fetch(`/api/scheduled-posts/${id}/run-now`, { method: "POST" });
    const data = await res.json();
    alert(data.message || "Executed.");
    loadScheduledPostsList();
  } catch (e) {
    alert("Failed to execute post.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("scheduled-posts-container")) {
    loadScheduledPostsList();
  }
});
