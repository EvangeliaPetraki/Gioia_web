import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { AppModule } from "./app.module";
import { auth } from "./auth/auth";

async function bootstrap() {
  // Body parsing is disabled globally so Better Auth can read the raw request;
  // we re-enable express's JSON/urlencoded parsers for everything else below.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.setGlobalPrefix("api");

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });

  // Better Auth owns /api/auth/* (sign-in, session, admin/*). Mount it before the
  // body parser so it receives the raw body; other routes fall through to express.json().
  const authHandler = toNodeHandler(auth);
  app.use((req, res, next) => {
    if (req.originalUrl.startsWith("/api/auth")) {
      void authHandler(req, res);
      return;
    }
    next();
  });
  // Raise the JSON body limit well above express's 100 KB default: the
  // aggregate-workbook export POSTs the full Gioia data structure (hundreds of
  // rows + descriptions) back to the server, which overflows the default (413).
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3001);
  // Bind 0.0.0.0 (not the default IPv6 `::`) so hosting proxies like Railway,
  // which connect over IPv4, can reach the app — otherwise they return 502.
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`API ready on port ${port} (prefix /api)`);
}

bootstrap();
