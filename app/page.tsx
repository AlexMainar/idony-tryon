import {redirect} from "next/navigation";

export default function HomePage() {
    redirect("/tryon")
  return (
    <main className="flex items-center justify-center min-h-screen bg-white text-black">
      <h1 className="text-2xl font-bold">Idony Try-On App</h1>
    </main>
  );
}
