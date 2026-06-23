import { Module } from "@nestjs/common";
import { AnalysisController } from "./analysis.controller";
import { AnalysisService } from "./analysis.service";
import { PdfService } from "./pdf.service";
import { GioiaService } from "./gioia.service";
import { CodebookService } from "./codebook.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [AnalysisController],
  providers: [AnalysisService, PdfService, GioiaService, CodebookService],
})
export class AnalysisModule {}
