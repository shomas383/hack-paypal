// Demo listings for the seller console (the Classify panel's "Use a sample" links and `pnpm seller:seed`). Generic text,
// no brands. Prices are the seller's own entries in integer minor units.
//  - The Japanese-language watch leaves out the jewel count, which separates the 9102.21 lines, so the classifier routes
//    it to review with choice questions built from the official chains; the seller answers, accepts and publishes it.
//  - The denim is P08's title from the verified sheet. In the grounded eval it landed in review with attributes the
//    listing doesn't state, which produces the "none of these apply" confirmation.
export interface SellerSample {
  key: 'watch-ja' | 'denim-p08';
  label: string;
  title: string;
  description?: string;
  origin: 'JP';
  priceMinor: number;
  shippingMinor: number;
}

export const SELLER_SAMPLES: readonly SellerSample[] = [
  {
    key: 'watch-ja',
    label: 'Japanese watch listing',
    title: '自動巻き ダイバーズウォッチ ステンレスケース ステンレスブレス 1990年代',
    description: '自動巻きムーブメント。ケースとブレスレットはステンレススチール製。日本製。動作確認済み。',
    origin: 'JP',
    priceMinor: 30_000,
    shippingMinor: 2_500,
  },
  {
    key: 'denim-p08',
    label: 'denim jeans',
    title: "Men's selvedge blue denim jeans, 100% cotton",
    origin: 'JP',
    priceMinor: 20_000,
    shippingMinor: 2_500,
  },
];
