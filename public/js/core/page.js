// Page bootstrap helpers shared by the page scripts.
import { icon } from "./icons.js";

// Buttons and links declared in HTML with data-icon="name" get their SVG icon.
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (el.dataset.iconDone) return;
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    el.dataset.iconDone = "1";
  });
}
