env "local" {
  dev = "docker://postgres/18/dev?search_path=public"
  format {
    migrate {
      dir = "file://migrations"
      format = "sql"
    }
  }
}

lint {
  deprecated {
    "string" = "text"
  }
}
