import { Link } from "aleph/react";

export default function E404() {
  return (
    <div
      className="w-screen flex flex-col items-center justify-center"
      style={{
        height: "calc(100vh - 2 * 80px)",
      }}
    >
      <h2 className="text-2xl font-bold mt">
        Ooooooops, nothing here!
      </h2>
      <p className="mt-2">
        <Link
          className="text-gray-500 hover:underline"
          to="/"
        >
          Go back to the homepage
        </Link>
      </p>
    </div>
  );
}
