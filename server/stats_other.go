//go:build !linux

package main

// diskPercent: poza Linuksem (praca lokalna na Windows) metryka niedostępna — front pokaże „—”.
func diskPercent(string) *float64 { return nil }
