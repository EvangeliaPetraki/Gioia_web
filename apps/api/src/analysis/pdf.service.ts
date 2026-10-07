import { BadRequestException, Injectable } from "@nestjs/common";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

@Injectable()
export class PdfService {
  /** Extract plain text from a PDF buffer. Throws if the PDF has no text layer. */
  async extractText(buffer: Buffer): Promise<string> {
    let text: string;
    try {
      const result = await pdfParse(buffer);
      text = (result.text ?? "").trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      throw new BadRequestException(`Could not read PDF: ${message}`);
    }

    // pdf-parse pads its output with a newline per page, so a pure image scan
    // (no text layer at all) can still clear a raw-length check — count only
    // non-whitespace characters to actually detect "no extractable text".
    if (text.replace(/\s+/g, "").length < 100) {
      throw new BadRequestException(
        "The PDF contains no extractable text (it may be a scanned image). Provide a text-based PDF.",
      );
    }
    return text;
  }
}
