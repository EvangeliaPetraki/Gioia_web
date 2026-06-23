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

    if (text.length < 100) {
      throw new BadRequestException(
        "The PDF contains no extractable text (it may be a scanned image). Provide a text-based PDF.",
      );
    }
    return text;
  }
}
