import FaceMeshComponent from "./components/FaceMesh";

export default function TryOnPage() {
    return (
        <main className="flex flex-col items-center justify-center min-h-screen bg-white text-black">
            <h1 className="text-2xl font-bold mb-4">🎨 Idony Try-On</h1>
            <FaceMeshComponent />
        </main>
    );
}