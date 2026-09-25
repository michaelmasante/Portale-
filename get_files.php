<?php
// Impedisce la stampa di warning/errori HTML che rovinano il JSON
error_reporting(0);
ini_set('display_errors', 0);

header('Content-Type: application/json; charset=utf-8');

$dir = 'File/Motori/';

// Controllo se la cartella esiste
if (!is_dir($dir)) {
    echo json_encode([]);
    exit;
}

// Recupera tutti i file .xlsx e .xls
$files = glob($dir . '*.{xlsx,xls}', GLOB_BRACE);

echo json_encode($files ? array_values($files) : []);
exit;
?>