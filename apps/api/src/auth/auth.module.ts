import { Module } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { AdminBootstrapService } from "./admin-bootstrap.service";

@Module({
  providers: [AuthGuard, AdminBootstrapService],
  exports: [AuthGuard],
})
export class AuthModule {}
