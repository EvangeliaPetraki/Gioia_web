import { Module } from "@nestjs/common";
import { AnalysisController } from "./analysis.controller";
import { AnalysisService } from "./analysis.service";
import { PdfService } from "./pdf.service";
import { GioiaService } from "./gioia.service";
import { CodebookService } from "./codebook.service";
import { CaseStudyService } from "./case-study.service";
import { SettingsService } from "./settings.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    PdfService,
    GioiaService,
    CodebookService,
    CaseStudyService,
    SettingsService,
  ],
})
export class AnalysisModule {}
