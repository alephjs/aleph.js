import { useData } from "aleph/react";

export default function Comments() {
  const { data: { comments } } = useData<{ comments: string[] }>();

  return (
    <>
      {comments.map((comment, i) => (
        <p className="comment" key={i}>
          {comment}
        </p>
      ))}
    </>
  );
}
