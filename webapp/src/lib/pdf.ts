import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { PdfPreview } from "./pdf-format";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function getPdfPreview(file: File): Promise<PdfPreview> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let thumbnailDataUrl = "";
  let firstPageText = "";

  try {
    const page = await pdf.getPage(1);

    // Tekst extractie (voor classificatie)
    try {
      const content = await page.getTextContent();
      firstPageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
    } catch {
      firstPageText = "";
    }

    // Thumbnail rendering
    const viewport = page.getViewport({ scale: 0.6 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      // pdfjs v4 vereist `canvas` ook expliciet in de render-params
      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      } as unknown as Parameters<typeof page.render>[0]).promise;
      thumbnailDataUrl = canvas.toDataURL("image/png");
    }
  } finally {
    pdf.destroy();
  }

  return {
    pageCount: pdf.numPages,
    thumbnailDataUrl,
    fileSize: file.size,
    firstPageText,
  };
}
