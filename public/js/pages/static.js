// Help, legal and error pages: readable with or without signing in.
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";

const body = document.body.dataset;
mountLayout({ page: body.page, title: body.title, publicPage: true }).then(() => hydrateIcons());
