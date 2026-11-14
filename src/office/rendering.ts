export function softwareRenderer(name: string) {
  return /swiftshader|llvmpipe|softpipe|software rasterizer|software renderer/i.test(name);
}
