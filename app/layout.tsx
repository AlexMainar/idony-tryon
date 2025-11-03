export const metadata = {
  title: "Idony Try-On",
  description: "Virtual try-on experience by Idony Cosmetics",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-black">{children}</body>
    </html>
  );
}