/** @type {import('next').NextConfig} */
function normalizeLocalApiBase(value) {
  try {
    const url = new URL(value);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

const apiBase = normalizeLocalApiBase(
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"
);

const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/health",
        destination: `${apiBase}/health`,
      },
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
