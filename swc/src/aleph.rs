pub fn get_aleph_version() -> String {
    let version = include_str!("../../version.ts");
    version
        .split("'")
        .collect::<Vec<&str>>()
        .get(1)
        .unwrap()
        .to_string()
}
