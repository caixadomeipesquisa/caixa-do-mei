/** @type {import('next').NextConfig} */
const nextConfig = {
  // Site estático: roda na Vercel (Hobby) ou em qualquer hospedagem de arquivos.
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
