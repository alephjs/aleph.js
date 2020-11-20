var _a, _b;
// ? registers top-level exported named arrow functions
export const Hello = () => {
    function handleClick() { }
    return <h1 onClick={handleClick}>Hi</h1>;
};
_a = Hello;
$RefreshReg$(_a, "Hello");
export let Bar = (props) => <Hello />;
_b = Bar;
$RefreshReg$(_b, "Bar");
export default () => {
    // This one should be ignored.
    // You should name your components.
    return <Hello />;
};
