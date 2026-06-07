// .ascii はビルド時に text として import する（tsdown loader / vitest plugin で解決）
declare module "*.ascii" {
  const content: string;

  export default content;
}
