/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8080/api/:path*'
      }
    ];
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({
        'canvas': 'commonjs canvas',
        'konva': 'commonjs konva',
        'react-konva': 'commonjs react-konva'
      });
    }
    
    // Additional fallbacks for client-side
    config.resolve.fallback = {
      ...config.resolve.fallback,
      canvas: false,
    };
    
    return config;
  },
}

export default nextConfig
