/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false
  },
  async rewrites() {
    const configuredApiUrl = process.env.API_URL?.trim();
    if (process.env.NODE_ENV === 'production' && !configuredApiUrl) {
      throw new Error('API_URL must be set to the public API base URL when building for production.');
    }

    const apiUrl = configuredApiUrl ?? 'http://localhost:4000';
    let parsedApiUrl;
    try {
      parsedApiUrl = new URL(apiUrl);
    } catch {
      throw new Error('API_URL must be an absolute HTTP or HTTPS URL.');
    }
    if (parsedApiUrl.protocol !== 'http:' && parsedApiUrl.protocol !== 'https:') {
      throw new Error('API_URL must be an absolute HTTP or HTTPS URL.');
    }

    const destination = `${apiUrl.replace(/\/+$/, '')}/api/v1/:path*`;
    return [{ source: '/api/v1/:path*', destination }];
  }
};

export default nextConfig;
