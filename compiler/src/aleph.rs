// Copyright 2020-2021 postUI Lab. All rights reserved. MIT license.

lazy_static! {
    pub static ref VERSION: String = {
        let ts = include_str!("../../version.ts");
        ts.split("'")
            .collect::<Vec<&str>>()
            .get(1)
            .unwrap()
            .to_string()
    };
}
