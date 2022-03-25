export default function Index() {
  return (
    <>
      <div className="h-full text-center flex select-none all:transition-400">
        <div className="ma">
          <div className="text-5xl fw100 animate-bounce-alt animate-count-infinite animate-1s">
            unocss
          </div>
          <div className="op30 text-lg fw300 m1">
            The instant on-demand Atomic CSS engine.
          </div>
          <div className="m2 flex justify-center text-2xl op30 hover:op80">
            <a
              className="i-carbon-logo-github text-inherit"
              href="https://github.com/antfu/unocss"
              target="_blank"
            />
          </div>
        </div>
      </div>
      <div className="absolute bottom-5 right-0 left-0 text-center op30 fw300">
        on-demand · instant · fully customizable
      </div>
    </>
  );
}
