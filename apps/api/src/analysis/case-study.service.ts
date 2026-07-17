import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CaseStudyCatalogDto,
  CaseStudyTypeDto,
  CreateCaseStudyTypeDto,
  CreateRegionCaseStudyDto,
  CreateRegionDto,
  RegionCaseStudyDto,
  RegionDto,
  UpdateRegionDto,
} from "@gioia/dto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Viewer } from "../auth/current-user.decorator";

/**
 * Owns the case-study organisation: countries → regions → case studies, and the
 * per-region selection of analysed files (FileSelection). Analyses themselves
 * are stored/scoped by CodebookService; this service only resolves *which*
 * documents belong to a region's case study.
 */
@Injectable()
export class CaseStudyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The organisation tree + case-study-type taxonomy for the UI. Non-admins see
   * only the regions they own; admins see everything.
   */
  async getCatalog(viewer: Viewer): Promise<CaseStudyCatalogDto> {
    const [regions, types] = await Promise.all([
      this.prisma.region.findMany({
        where: viewer.isAdmin ? undefined : { owners: { some: { userId: viewer.id } } },
        orderBy: [{ country: "asc" }, { name: "asc" }],
        include: {
          owners: { include: { user: { select: { id: true, name: true, email: true } } } },
          caseStudies: {
            include: {
              caseStudyType: true,
              _count: { select: { selections: true } },
            },
          },
        },
      }),
      this.prisma.caseStudyType.findMany({ orderBy: { name: "asc" } }),
    ]);

    return {
      regions: regions.map((r) => ({
        id: r.id,
        country: r.country,
        name: r.name,
        owners: r.owners.map((o) => ({ id: o.user.id, name: o.user.name, email: o.user.email })),
        caseStudies: r.caseStudies
          .map((cs) => ({
            id: cs.id,
            regionId: cs.regionId,
            caseStudyTypeId: cs.caseStudyTypeId,
            caseStudyName: cs.caseStudyType.name,
            documentCount: cs._count.selections,
          }))
          .sort((a, b) => a.caseStudyName.localeCompare(b.caseStudyName)),
      })),
      caseStudyTypes: types.map((t) => ({ id: t.id, name: t.name })),
    };
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async createRegion(dto: CreateRegionDto): Promise<RegionDto> {
    const country = dto.country.trim();
    const name = dto.name.trim();
    if (!country || !name) throw new BadRequestException("Country and region name are required.");

    const owners = await this.loadOwners(dto.userIds);
    try {
      const r = await this.prisma.region.create({
        data: {
          country,
          name,
          owners: { create: owners.map((o) => ({ userId: o.id })) },
        },
      });
      return {
        id: r.id,
        country: r.country,
        name: r.name,
        owners: owners.map((o) => ({ id: o.id, name: o.name, email: o.email })),
      };
    } catch (e) {
      throw this.asConflict(e, `Region "${name}" already exists for ${country}.`);
    }
  }

  /** Rename a region / change its country. */
  async updateRegion(id: string, dto: UpdateRegionDto): Promise<RegionDto> {
    const country = dto.country.trim();
    const name = dto.name.trim();
    if (!country || !name) throw new BadRequestException("Country and region name are required.");
    const region = await this.prisma.region.findUnique({ where: { id } });
    if (!region) throw new NotFoundException("Region not found.");
    try {
      const updated = await this.prisma.region.update({
        where: { id },
        data: { country, name },
        include: { owners: { include: { user: { select: { id: true, name: true, email: true } } } } },
      });
      return {
        id: updated.id,
        country: updated.country,
        name: updated.name,
        owners: updated.owners.map((o) => ({ id: o.user.id, name: o.user.name, email: o.user.email })),
      };
    } catch (e) {
      throw this.asConflict(e, `Region "${name}" already exists for ${country}.`);
    }
  }

  /** Replace a region's owner set (add/remove owners after creation). */
  async setRegionOwners(regionId: string, userIds: string[]): Promise<RegionDto> {
    const region = await this.prisma.region.findUnique({ where: { id: regionId } });
    if (!region) throw new NotFoundException("Region not found.");

    const owners = await this.loadOwners([...new Set(userIds)]);
    await this.prisma.$transaction([
      this.prisma.regionOwner.deleteMany({ where: { regionId } }),
      this.prisma.regionOwner.createMany({
        data: owners.map((o) => ({ regionId, userId: o.id })),
      }),
    ]);
    return {
      id: region.id,
      country: region.country,
      name: region.name,
      owners: owners.map((o) => ({ id: o.id, name: o.name, email: o.email })),
    };
  }

  /** Load the given users, erroring if any id is unknown. */
  private async loadOwners(userIds: string[]): Promise<{ id: string; name: string; email: string }[]> {
    const ids = [...new Set(userIds.map((s) => s.trim()).filter(Boolean))];
    if (ids.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    if (users.length !== ids.length) {
      throw new NotFoundException("One or more selected owner users were not found.");
    }
    return users;
  }

  async createCaseStudyType(dto: CreateCaseStudyTypeDto): Promise<CaseStudyTypeDto> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("Case-study name is required.");
    try {
      const t = await this.prisma.caseStudyType.create({ data: { name } });
      return { id: t.id, name: t.name };
    } catch (e) {
      throw this.asConflict(e, `Case study "${name}" already exists.`);
    }
  }

  async createRegionCaseStudy(dto: CreateRegionCaseStudyDto): Promise<RegionCaseStudyDto> {
    const [region, type] = await Promise.all([
      this.prisma.region.findUnique({ where: { id: dto.regionId } }),
      this.prisma.caseStudyType.findUnique({ where: { id: dto.caseStudyTypeId } }),
    ]);
    if (!region) throw new NotFoundException("Region not found.");
    if (!type) throw new NotFoundException("Case-study type not found.");
    try {
      const cs = await this.prisma.regionCaseStudy.create({
        data: { regionId: dto.regionId, caseStudyTypeId: dto.caseStudyTypeId },
      });
      return {
        id: cs.id,
        regionId: cs.regionId,
        caseStudyTypeId: cs.caseStudyTypeId,
        caseStudyName: type.name,
        documentCount: 0,
      };
    } catch (e) {
      throw this.asConflict(e, `${region.name} already runs the "${type.name}" case study.`);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  /** Delete a region and all its case-study links (FileSelections cascade). */
  async deleteRegion(id: string): Promise<void> {
    await this.mustExist(this.prisma.region.findUnique({ where: { id } }), "Region");
    await this.prisma.region.delete({ where: { id } });
  }

  /** Delete a region's case study (only its file selections, not the analyses). */
  async deleteRegionCaseStudy(id: string): Promise<void> {
    await this.mustExist(this.prisma.regionCaseStudy.findUnique({ where: { id } }), "Case study");
    await this.prisma.regionCaseStudy.delete({ where: { id } });
  }

  // ── Resolution helpers (used by the analysis flow) ─────────────────────────

  /**
   * Resolve a region-case-study id to its case-study type, enforcing that the
   * viewer owns the region (admins bypass). 404 if missing, 403 if not allowed.
   */
  async resolveCaseStudyType(
    regionCaseStudyId: string,
    viewer: Viewer,
  ): Promise<{ regionCaseStudyId: string; caseStudyTypeId: string; caseStudyName: string }> {
    const rcs = await this.prisma.regionCaseStudy.findUnique({
      where: { id: regionCaseStudyId },
      include: {
        caseStudyType: true,
        region: { select: { owners: { select: { userId: true } } } },
      },
    });
    if (!rcs) throw new NotFoundException("Selected case study not found.");
    this.assertOwner(rcs.region.owners, viewer);
    return {
      regionCaseStudyId: rcs.id,
      caseStudyTypeId: rcs.caseStudyTypeId,
      caseStudyName: rcs.caseStudyType.name,
    };
  }

  /**
   * Document_IDs the given region-case-study has selected, enforcing that the
   * viewer owns the region (admins bypass).
   */
  async documentIdsFor(regionCaseStudyId: string, viewer: Viewer): Promise<string[]> {
    const rcs = await this.prisma.regionCaseStudy.findUnique({
      where: { id: regionCaseStudyId },
      include: {
        region: { select: { owners: { select: { userId: true } } } },
        selections: { select: { documentId: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!rcs) throw new NotFoundException("Selected case study not found.");
    this.assertOwner(rcs.region.owners, viewer);
    return rcs.selections.map((s) => s.documentId);
  }

  /** Throw 403 unless the viewer is an admin or one of the region's owners. */
  private assertOwner(owners: { userId: string }[], viewer: Viewer): void {
    if (viewer.isAdmin) return;
    if (owners.some((o) => o.userId === viewer.id)) return;
    throw new ForbiddenException("You do not have access to this case study.");
  }

  /**
   * Full context for one region-case-study (access-checked): its selected
   * document ids plus display names, for building its codebook / filename.
   */
  async getContext(
    regionCaseStudyId: string,
    viewer: Viewer,
  ): Promise<{ documentIds: string[]; country: string; regionName: string; caseStudyName: string }> {
    const rcs = await this.prisma.regionCaseStudy.findUnique({
      where: { id: regionCaseStudyId },
      include: {
        caseStudyType: true,
        region: { select: { country: true, name: true, owners: { select: { userId: true } } } },
        selections: { select: { documentId: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!rcs) throw new NotFoundException("Selected case study not found.");
    this.assertOwner(rcs.region.owners, viewer);
    return {
      documentIds: rcs.selections.map((s) => s.documentId),
      country: rcs.region.country,
      regionName: rcs.region.name,
      caseStudyName: rcs.caseStudyType.name,
    };
  }

  /** Link an analysed document into a region's case study (idempotent). */
  async linkSelection(
    regionCaseStudyId: string,
    documentId: string,
    originalFilename: string,
  ): Promise<void> {
    await this.prisma.fileSelection.upsert({
      where: { regionCaseStudyId_documentId: { regionCaseStudyId, documentId } },
      create: { regionCaseStudyId, documentId, originalFilename },
      update: {},
    });
  }

  /**
   * Exclude a file from a region's case study (owner or admin). This unlinks the
   * FileSelection only — the underlying analysis (`AnalyzedDocument`) is kept, so
   * it stays available to other case studies that selected the same file.
   */
  async removeSelection(
    regionCaseStudyId: string,
    documentId: string,
    viewer: Viewer,
  ): Promise<void> {
    const rcs = await this.prisma.regionCaseStudy.findUnique({
      where: { id: regionCaseStudyId },
      include: { region: { select: { owners: { select: { userId: true } } } } },
    });
    if (!rcs) throw new NotFoundException("Selected case study not found.");
    this.assertOwner(rcs.region.owners, viewer);
    // Unlink only — never delete the AnalyzedDocument (it may be shared).
    await this.prisma.fileSelection.deleteMany({ where: { regionCaseStudyId, documentId } });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async mustExist<T>(p: Promise<T | null>, label: string): Promise<T> {
    const found = await p;
    if (!found) throw new NotFoundException(`${label} not found.`);
    return found;
  }

  private asConflict(e: unknown, message: string): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return new ConflictException(message);
    }
    return e instanceof Error ? e : new Error(String(e));
  }
}
