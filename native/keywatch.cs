// BuildSense keywatch : détecte les raccourcis de BuildSense quand le jeu est au premier plan.
//
// Le jeu (League of Legends) bloque les raccourcis globaux classiques de Windows (RegisterHotKey)
// tant qu'il a le focus. Ce petit programme lit seulement l'état des touches (GetAsyncKeyState),
// sans hook, sans injection et sans rien envoyer au jeu.
//
// Entrée (stdin), une ligne par raccourci, remplacée à chaque envoi d'une ligne "END" :
//   <nom> <ctrl 0/1> <shift 0/1> <alt 0/1> <win 0/1> <code de touche virtuelle>
// Sortie (stdout) : le nom du raccourci à chaque appui.
// Compilé par scripts/build-win.js avec le compilateur C# fourni avec Windows (csc.exe).

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

class KeyWatch
{
    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vKey);

    class Combo { public string Name; public bool Ctrl, Shift, Alt, Win; public int Vk; public bool Down; }

    static readonly object Gate = new object();
    static List<Combo> combos = new List<Combo>();

    static bool Pressed(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

    static void ReadInput()
    {
        var next = new List<Combo>();
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            line = line.Trim();
            if (line == "END")
            {
                lock (Gate) combos = next;
                next = new List<Combo>();
                continue;
            }
            var p = line.Split(' ');
            if (p.Length != 6) continue;
            int vk;
            if (!int.TryParse(p[5], out vk) || vk <= 0 || vk > 254) continue;
            next.Add(new Combo { Name = p[0], Ctrl = p[1] == "1", Shift = p[2] == "1", Alt = p[3] == "1", Win = p[4] == "1", Vk = vk });
        }
        Environment.Exit(0); // BuildSense fermé : on s'arrête aussi
    }

    static void Main()
    {
        Console.Out.Flush();
        new Thread(ReadInput) { IsBackground = true }.Start();
        while (true)
        {
            List<Combo> list;
            lock (Gate) list = combos;
            if (list.Count > 0)
            {
                bool ctrl = Pressed(0x11), shift = Pressed(0x10), alt = Pressed(0x12), win = Pressed(0x5B) || Pressed(0x5C);
                foreach (var c in list)
                {
                    bool down = Pressed(c.Vk) && ctrl == c.Ctrl && shift == c.Shift && alt == c.Alt && win == c.Win;
                    if (down && !c.Down)
                    {
                        Console.WriteLine(c.Name);
                        Console.Out.Flush();
                    }
                    c.Down = down;
                }
            }
            Thread.Sleep(list.Count > 0 ? 25 : 200);
        }
    }
}
