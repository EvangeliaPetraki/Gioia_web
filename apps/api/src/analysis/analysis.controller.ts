import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type {
  AnalysisSummaryDto,
  CodebookDto,
  PolicyDetailDto,
  PolicyListItemDto,
} from "@gioia/dto";
import { UpdateNoteDto } from "@gioia/dto";
import { AnalysisService } from "./analysis.service";
import { AuthGuard } from "../auth/auth.guard";

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

@Controller("analysis")
@UseGuards(AuthGuard)
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_PDF_BYTES },
      fileFilter: (_req, file, cb) => {
        const isPdf =
          file.mimetype === "application/pdf" ||
          file.originalname.toLowerCase().endsWith(".pdf");
        cb(isPdf ? null : new BadRequestException("Only PDF files are accepted."), isPdf);
      },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File): Promise<AnalysisSummaryDto> {
    if (!file) {
      throw new BadRequestException("No PDF file was uploaded (field name must be 'file').");
    }
    return this.analysis.analyseDocument(file.originalname, file.buffer);
  }

  @Get("policies")
  listPolicies(): Promise<PolicyListItemDto[]> {
    return this.analysis.listPolicies();
  }

  @Get("codebook")
  getCodebook(): Promise<CodebookDto> {
    return this.analysis.getWorkbookData();
  }

  @Get("policies/:documentId")
  async getPolicy(@Param("documentId") documentId: string): Promise<PolicyDetailDto> {
    const detail = await this.analysis.getPolicyDetail(documentId);
    if (!detail) {
      throw new NotFoundException(`No analysis found for document ${documentId}.`);
    }
    return detail;
  }

  @Patch("policies/:documentId/note")
  async updateNote(
    @Param("documentId") documentId: string,
    @Body() dto: UpdateNoteDto,
  ): Promise<{ documentId: string; note: string }> {
    const note = await this.analysis.updateNote(documentId, dto.note);
    if (note === null) {
      throw new NotFoundException(`No analysis found for document ${documentId}.`);
    }
    return { documentId, note };
  }

  @Get("workbook")
  @Header(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  )
  async downloadWorkbook(
    @Res({ passthrough: true }) res: Response,
    @Query("docs") docs?: string,
  ): Promise<StreamableFile> {
    const policies = await this.analysis.listPolicies();
    if (policies.length === 0) {
      throw new NotFoundException("No analysed documents yet. Analyse a document first.");
    }
    // `docs` (comma-separated Document_IDs) limits the export to those documents.
    const ids = docs
      ? docs.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const filename = this.analysis.workbookFilename();
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    return new StreamableFile(await this.analysis.generateWorkbook(ids));
  }
}
