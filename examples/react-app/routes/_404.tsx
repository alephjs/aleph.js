// support jsx on deno deploy
/** @jsxImportSource https://esm.sh/react@18.2.0 */

import { Link } from "aleph/react";

export default function E404() {
  return (
    <div className="screen e404">
      <h2>
        Ooooooops, nothing here!
      </h2>
      <p>
        <Link to="/">Go back to the homepage</Link>
      </p>
    </div>
  );
}
