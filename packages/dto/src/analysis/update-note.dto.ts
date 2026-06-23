import { IsString, MaxLength } from "class-validator";

/** Body of PATCH /analysis/policies/:documentId/note — the user's free-text note. */
export class UpdateNoteDto {
  @IsString()
  @MaxLength(5000)
  note!: string;
}
