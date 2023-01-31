import type { FC, PropsWithChildren } from "react";
import { createElement } from "react";

// The props `id` is generated by `rehype-slug` plugin
export const Heading: FC<PropsWithChildren<{ id: string; level: number }>> = ({ id, level, children, ...rest }) => {
  return createElement(
    `h${level}`,
    { ...rest, id },
    <>
      <a className="anchor" href={`#${id}`}>§</a>
      {children}
    </>,
  );
};

export const components: Record<string, FC<PropsWithChildren<{ id: string }>>> = {};

for (let i = 0; i < 6; i++) {
  components[`h${i + 1}`] = (props) => {
    return <Heading level={i + 1} {...props} />;
  };
}