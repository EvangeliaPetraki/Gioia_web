import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type {
  AnalysisSettingsDto,
  AnalysisSettingsResponseDto,
  AnalysisSummaryDto,
  CaseStudyAggregateStatusDto,
  CaseStudyCatalogDto,
  CaseStudyTypeDto,
  CodebookDto,
  CrossDocumentAggregateDto,
  PolicyDetailDto,
  PolicyListItemDto,
  PromptsDto,
  RegionCaseStudyDto,
  RegionDto,
} from "@gioia/dto";
import {
  CreateCaseStudyTypeDto,
  CreateRegionCaseStudyDto,
  CreateRegionDto,
  ExtractAggregateDto,
  SetRegionOwnersDto,
  UpdateAnalysisSettingsDto,
  UpdateNoteDto,
  UpdateRegionDto,
} from "@gioia/dto";
import { AnalysisService } from "./analysis.service";
import { CaseStudyService } from "./case-study.service";
import { AuthGuard } from "../auth/auth.guard";
import { AdminGuard } from "../auth/admin.guard";
import { CurrentUser, toViewer, type SessionUser } from "../auth/current-user.decorator";

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

@Controller("analysis")
@UseGuards(AuthGuard)
export class AnalysisController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly caseStudies: CaseStudyService,
  ) {}

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
  async upload(
    @CurrentUser() user: SessionUser,
    @Body("regionCaseStudyId") regionCaseStudyId?: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AnalysisSummaryDto> {
    if (!file) {
      throw new BadRequestException("No PDF file was uploaded (field name must be 'file').");
    }
    if (!regionCaseStudyId) {
      throw new BadRequestException("A 'regionCaseStudyId' form field is required.");
    }
    return this.analysis.analyseDocument(
      file.originalname,
      file.buffer,
      regionCaseStudyId,
      toViewer(user),
    );
  }

  // ── Case-study organisation ────────────────────────────────────────────────

  /** The region→case-study tree the user may see (admins see all). */
  @Get("catalog")
  getCatalog(@CurrentUser() user: SessionUser): Promise<CaseStudyCatalogDto> {
    return this.caseStudies.getCatalog(toViewer(user));
  }

  @Post("regions")
  @UseGuards(AdminGuard)
  createRegion(@Body() dto: CreateRegionDto): Promise<RegionDto> {
    return this.caseStudies.createRegion(dto);
  }

  @Delete("regions/:id")
  @UseGuards(AdminGuard)
  @HttpCode(204)
  deleteRegion(@Param("id") id: string): Promise<void> {
    return this.caseStudies.deleteRegion(id);
  }

  /** Rename a region / change its country (admin). */
  @Patch("regions/:id")
  @UseGuards(AdminGuard)
  updateRegion(@Param("id") id: string, @Body() dto: UpdateRegionDto): Promise<RegionDto> {
    return this.caseStudies.updateRegion(id, dto);
  }

  /** Replace a region's owner set — add/remove owners after creation (admin). */
  @Put("regions/:id/owners")
  @UseGuards(AdminGuard)
  setRegionOwners(
    @Param("id") id: string,
    @Body() dto: SetRegionOwnersDto,
  ): Promise<RegionDto> {
    return this.caseStudies.setRegionOwners(id, dto.userIds);
  }

  @Post("case-study-types")
  @UseGuards(AdminGuard)
  createCaseStudyType(@Body() dto: CreateCaseStudyTypeDto): Promise<CaseStudyTypeDto> {
    return this.caseStudies.createCaseStudyType(dto);
  }

  @Post("region-case-studies")
  @UseGuards(AdminGuard)
  createRegionCaseStudy(@Body() dto: CreateRegionCaseStudyDto): Promise<RegionCaseStudyDto> {
    return this.caseStudies.createRegionCaseStudy(dto);
  }

  @Delete("region-case-studies/:id")
  @UseGuards(AdminGuard)
  @HttpCode(204)
  deleteRegionCaseStudy(@Param("id") id: string): Promise<void> {
    return this.caseStudies.deleteRegionCaseStudy(id);
  }

  /** The files one region-case-study has selected (owner or admin only). */
  @Get("region-case-studies/:id/policies")
  listCaseStudyPolicies(
    @Param("id") id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<PolicyListItemDto[]> {
    return this.analysis.listPoliciesForCaseStudy(id, toViewer(user));
  }

  /**
   * Exclude a file from a case study (owner or admin). Unlinks only — the
   * analysis stays in the database and in any other case study that selected it.
   */
  @Delete("region-case-studies/:id/files/:documentId")
  @HttpCode(204)
  excludeFile(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    return this.analysis.excludeFileFromCaseStudy(id, documentId, toViewer(user));
  }

  /**
   * Aggregate dimensions over one region-case-study's selected files. Owner or
   * admin — access is enforced in the service (403 for a non-owner).
   */
  @Post("region-case-studies/:id/aggregate")
  aggregateCaseStudy(
    @Param("id") id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<CrossDocumentAggregateDto> {
    return this.analysis.aggregateForCaseStudy(id, toViewer(user));
  }

  /** Freshness of a case study's persisted aggregate vs its current files. */
  @Get("region-case-studies/:id/aggregate-status")
  aggregateStatus(
    @Param("id") id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<CaseStudyAggregateStatusDto> {
    return this.analysis.getAggregateStatus(id, toViewer(user));
  }

  /** One region-case-study's codebook as structured data (owner/admin only). */
  @Get("region-case-studies/:id/codebook")
  getCaseStudyCodebook(
    @Param("id") id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<CodebookDto> {
    return this.analysis.getCodebookForCaseStudy(id, toViewer(user));
  }

  /** Download one region-case-study's codebook Excel (owner/admin only). */
  @Get("region-case-studies/:id/workbook")
  @Header(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  )
  async downloadCaseStudyWorkbook(
    @Param("id") id: string,
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.analysis.generateCaseStudyWorkbook(id, toViewer(user));
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    return new StreamableFile(buffer);
  }

  /** Current model selection + available options (any authenticated user). */
  @Get("settings")
  getSettings(): Promise<AnalysisSettingsResponseDto> {
    return this.analysis.getSettings();
  }

  /** Change the model selection (admin only). */
  @Patch("settings")
  @UseGuards(AdminGuard)
  updateSettings(@Body() dto: UpdateAnalysisSettingsDto): Promise<AnalysisSettingsDto> {
    return this.analysis.updateSettings(dto);
  }

  /** Read-only view of the system prompts used in the LLM calls (admin only). */
  @Get("prompts")
  @UseGuards(AdminGuard)
  getPrompts(): Promise<PromptsDto> {
    return this.analysis.getPrompts();
  }

  /** Synthesise aggregate dimensions across selected documents (admin only). */
  @Post("aggregate")
  @UseGuards(AdminGuard)
  extractAggregate(@Body() dto: ExtractAggregateDto): Promise<CrossDocumentAggregateDto> {
    return this.analysis.aggregateDimensions(dto.documentIds);
  }

  /**
   * Export an already-generated aggregate result as Excel. Any authenticated
   * user — it just formats the result supplied in the request body.
   */
  @Post("aggregate/workbook")
  @Header(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  )
  async downloadAggregateWorkbook(
    @Res({ passthrough: true }) res: Response,
    @Body() dto: CrossDocumentAggregateDto,
  ): Promise<StreamableFile> {
    const suffix = dto.documentIds?.length ? dto.documentIds.join("_") : "selected-documents";
    res.set("Content-Disposition", `attachment; filename="Gioia_Aggregate_Dimensions_${suffix}.xlsx"`);
    return new StreamableFile(await this.analysis.generateAggregateWorkbook(dto));
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

}
