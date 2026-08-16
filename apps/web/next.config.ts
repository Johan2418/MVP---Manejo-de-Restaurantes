import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compilar TS de los paquetes del workspace (ej. @reservas/shared)
  transpilePackages: ["@reservas/shared"],
};

export default nextConfig;
