import "../styles/globals.css"; 

export const metadata = {
  title: "Idony Try-On",
  description: "Virtual try-on experience by Idony Cosmetics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full w-full">
      <body className="h-full w-full overflow-hidden bg-black text-white">
        <div id="app-root" className="h-full w-full overflow-hidden">
          {children}
        </div>
      </body>
    </html>
  );
}