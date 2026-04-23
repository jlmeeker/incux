// Package assets exposes the compiled frontend for embedding into the binary.
// This file must live at the repository root so that the //go:embed directive
// can reference web/dist, which is a sibling of this file.
package assets

import (
	"embed"
	"io/fs"
	"log"
)

//go:embed web/dist
var embeddedFiles embed.FS

// Frontend returns an fs.FS rooted at the compiled frontend output directory.
func Frontend() fs.FS {
	sub, err := fs.Sub(embeddedFiles, "web/dist")
	if err != nil {
		log.Fatalf("assets: failed to sub web/dist: %v", err)
	}
	return sub
}
