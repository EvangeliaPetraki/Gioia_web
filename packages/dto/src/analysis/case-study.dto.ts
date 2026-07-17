import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString, MaxLength } from "class-validator";

// ── Admin CRUD request bodies ───────────────────────────────────────────────

/** POST /analysis/regions (admin) — create a region under a country, owned by ≥1 users. */
export class CreateRegionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  country!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  /** The users who may see and use this region's case studies (at least one). */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  userIds!: string[];
}

/** PATCH /analysis/regions/:id (admin) — rename a region / change its country. */
export class UpdateRegionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  country!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}

/**
 * PUT /analysis/regions/:id/owners (admin) — replace a region's owner set. An
 * empty list makes the region admin-only.
 */
export class SetRegionOwnersDto {
  @IsArray()
  @IsString({ each: true })
  userIds!: string[];
}

/** POST /analysis/case-study-types (admin) — create a shared case-study type. */
export class CreateCaseStudyTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}

/**
 * POST /analysis/region-case-studies (admin) — attach a case-study type to a
 * region ("Crete's transportation").
 */
export class CreateRegionCaseStudyDto {
  @IsString()
  @IsNotEmpty()
  regionId!: string;

  @IsString()
  @IsNotEmpty()
  caseStudyTypeId!: string;
}

// ── Response shapes ─────────────────────────────────────────────────────────

export interface RegionOwnerDto {
  id: string;
  name: string;
  email: string;
}

export interface RegionDto {
  id: string;
  country: string;
  name: string;
  /** Users who may see/use this region (empty ⇒ admin-only). */
  owners: RegionOwnerDto[];
}

export interface CaseStudyTypeDto {
  id: string;
  name: string;
}

/** One region's case study, with how many files it has selected. */
export interface RegionCaseStudyDto {
  id: string;
  regionId: string;
  caseStudyTypeId: string;
  caseStudyName: string;
  documentCount: number;
}

/** A region together with the case studies it runs (dashboard tree). */
export interface RegionWithCaseStudiesDto extends RegionDto {
  caseStudies: RegionCaseStudyDto[];
}

/**
 * Everything the dashboard/admin UI needs to render the organisation:
 * the region→case-study tree plus the full case-study-type taxonomy.
 */
export interface CaseStudyCatalogDto {
  regions: RegionWithCaseStudiesDto[];
  caseStudyTypes: CaseStudyTypeDto[];
}
