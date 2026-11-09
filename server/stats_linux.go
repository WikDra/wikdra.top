//go:build linux

package main

import "syscall"

// diskPercent: zajętość systemu plików jak w PHP (1 − disk_free_space/disk_total_space,
// czyli bloki dostępne dla użytkownika względem wszystkich).
func diskPercent(path string) *float64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil || st.Blocks == 0 {
		return nil
	}
	return pct((1 - float64(st.Bavail)/float64(st.Blocks)) * 100)
}
